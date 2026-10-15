/**
 * @file Safe CloudFormation dialect analysis and semantic canonicalization.
 * @module cloudformation/fidelity
 * @description Derives a non-authoritative analysis projection without executing transforms.
 */
import type {
  CloudFormationFidelityAnalysis,
  CloudFormationImportDiagnostic,
  ProjectedCloudFormationResource,
  RoundTripComparison,
} from '../domain/types';
import { stableId } from '../domain/ids';

const MAX_FOREACH_DEPTH = 12;
const MAX_FOREACH_EXPANSIONS = 2_500;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function diagnostic(filename: string, severity: 'info' | 'warning' | 'error', code: string, message: string, path?: string): CloudFormationImportDiagnostic {
  return { id: stableId('fidelity', filename, code, path ?? '', message), filename, severity, code, message, ...(path ? { path } : {}), blocking: false };
}

function parametersWithDefaults(ast: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (!isRecord(ast.Parameters)) return {};
  return Object.fromEntries(Object.entries(ast.Parameters).flatMap(([name, raw]) => isRecord(raw) && 'Default' in raw ? [[name, raw.Default]] : []));
}

function replaceIdentifier(text: string, identifier: string, replacement: string): string {
  return text.replaceAll(`\${${identifier}}`, replacement).replaceAll(`&{${identifier}}`, replacement);
}

function substitute(value: unknown, identifier: string, replacement: unknown): unknown {
  if (typeof value === 'string') return replaceIdentifier(value, identifier, String(replacement));
  if (Array.isArray(value)) return value.map((entry) => substitute(entry, identifier, replacement));
  if (!isRecord(value)) return value;
  if (Object.keys(value).length === 1 && value.Ref === identifier) return structuredClone(replacement);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [replaceIdentifier(key, identifier, String(replacement)), substitute(entry, identifier, replacement)]));
}

function collectionValues(value: unknown, defaults: Readonly<Record<string, unknown>>): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && typeof value.Ref === 'string') {
    const resolved = defaults[value.Ref];
    if (Array.isArray(resolved)) return resolved;
    if (typeof resolved === 'string') return resolved.split(',').map((entry) => entry.trim());
  }
  return undefined;
}

interface ExpansionState {
  count: number;
  partial: boolean;
  readonly filename: string;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly diagnostics: CloudFormationImportDiagnostic[];
}

function expandValue(value: unknown, path: string, state: ExpansionState, depth: number): unknown {
  if (depth > MAX_FOREACH_DEPTH) {
    state.partial = true;
    state.diagnostics.push(diagnostic(state.filename, 'warning', 'FOREACH_DEPTH_LIMIT', `Fn::ForEach projection stopped after ${MAX_FOREACH_DEPTH} nested loops.`, path));
    return structuredClone(value);
  }
  if (Array.isArray(value)) return value.map((entry, index) => expandValue(entry, `${path}[${index}]`, state, depth));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith('Fn::ForEach::')) {
      output[key] = expandValue(entry, `${path}.${key}`, state, depth);
      continue;
    }
    const loopName = key.slice('Fn::ForEach::'.length);
    if (!Array.isArray(entry) || entry.length !== 3 || typeof entry[0] !== 'string' || !isRecord(entry[2])) {
      state.partial = true;
      output[key] = structuredClone(entry);
      state.diagnostics.push(diagnostic(state.filename, 'warning', 'FOREACH_INVALID_SHAPE', `${key} is preserved because its declaration is not a three-item loop tuple.`, `${path}.${key}`));
      continue;
    }
    const values = collectionValues(entry[1], state.defaults);
    if (!values) {
      state.partial = true;
      output[key] = structuredClone(entry);
      state.diagnostics.push(diagnostic(state.filename, 'warning', 'FOREACH_COLLECTION_UNRESOLVED', `${key} is preserved because its collection is not statically resolvable.`, `${path}.${key}`));
      continue;
    }
    for (const item of values) {
      state.count += 1;
      if (state.count > MAX_FOREACH_EXPANSIONS) {
        state.partial = true;
        output[key] = structuredClone(entry);
        state.diagnostics.push(diagnostic(state.filename, 'warning', 'FOREACH_EXPANSION_LIMIT', `Fn::ForEach projection exceeded ${MAX_FOREACH_EXPANSIONS} iterations and was truncated.`, `${path}.${key}`));
        break;
      }
      const fragment = expandValue(substitute(entry[2], entry[0], item), `${path}.${key}[${String(item)}]`, state, depth + 1);
      if (!isRecord(fragment)) continue;
      for (const [fragmentKey, fragmentValue] of Object.entries(fragment)) {
        if (fragmentKey in output) {
          state.partial = true;
          state.diagnostics.push(diagnostic(state.filename, 'error', 'FOREACH_LOGICAL_ID_COLLISION', `${key} generates duplicate key ${fragmentKey}.`, `${path}.${key}`));
        } else output[fragmentKey] = fragmentValue;
      }
    }
    void loopName;
  }
  return output;
}

function collectTransforms(value: unknown, path: string, results: Array<{ path: string; name: string }>): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectTransforms(entry, `${path}[${index}]`, results));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (key === 'Fn::Transform' && isRecord(entry) && typeof entry.Name === 'string') results.push({ path: childPath, name: entry.Name });
    collectTransforms(entry, childPath, results);
  }
}

function transformNames(transform: unknown): string[] {
  if (typeof transform === 'string') return [transform];
  if (Array.isArray(transform)) return transform.flatMap((entry) => typeof entry === 'string' ? [entry] : isRecord(entry) && typeof entry.Name === 'string' ? [entry.Name] : []);
  return isRecord(transform) && typeof transform.Name === 'string' ? [transform.Name] : [];
}

/** Builds the safe analysis view used by import, validation, and source presentation. */
export function analyzeTemplateFidelity(ast: Readonly<Record<string, unknown>>, filename: string): CloudFormationFidelityAnalysis {
  const diagnostics: CloudFormationImportDiagnostic[] = [];
  const transforms = transformNames(ast.Transform);
  const nestedTransforms: Array<{ path: string; name: string }> = [];
  collectTransforms(ast, '', nestedTransforms);
  const hasForEach = JSON.stringify(ast).includes('Fn::ForEach::');
  const resources = isRecord(ast.Resources) ? ast.Resources : {};
  const hasSam = Object.values(resources).some((raw) => isRecord(raw) && typeof raw.Type === 'string' && raw.Type.startsWith('AWS::Serverless::')) || transforms.includes('AWS::Serverless-2016-10-31');
  const cdkConstructPaths: Record<string, string> = {};
  const cdkHelpers: string[] = [];
  for (const [logicalId, raw] of Object.entries(resources)) {
    if (!isRecord(raw)) continue;
    if (isRecord(raw.Metadata) && typeof raw.Metadata['aws:cdk:path'] === 'string') cdkConstructPaths[logicalId] = raw.Metadata['aws:cdk:path'];
    if (raw.Type === 'AWS::CDK::Metadata' || logicalId === 'CDKMetadata' || logicalId === 'CheckBootstrapVersion') cdkHelpers.push(logicalId);
  }
  const hasCdk = Object.keys(cdkConstructPaths).length > 0 || cdkHelpers.length > 0 || (isRecord(ast.Rules) && 'CheckBootstrapVersion' in ast.Rules);
  const knownTransforms = new Set(['AWS::LanguageExtensions', 'AWS::Serverless-2016-10-31']);
  const transformRecords = [
    ...transforms.map((name, index) => ({ name, path: transforms.length > 1 ? `Transform[${index}]` : 'Transform', executionOrder: index, scope: 'top-level' as const, support: knownTransforms.has(name) ? 'partial' as const : 'preserved' as const })),
    ...nestedTransforms.map(({ name, path }, index) => ({ name, path, executionOrder: transforms.length + index, scope: 'nested' as const, support: 'preserved' as const })),
  ];
  transforms.forEach((name, index) => {
    if (name === 'AWS::LanguageExtensions') diagnostics.push(diagnostic(filename, 'info', 'LANGUAGE_EXTENSIONS_ANALYZED', 'AWS::LanguageExtensions is preserved; statically resolvable Fn::ForEach loops are projected for analysis.', `Transform${transforms.length > 1 ? `[${index}]` : ''}`));
    else if (name === 'AWS::Serverless-2016-10-31') diagnostics.push(diagnostic(filename, 'info', 'SAM_ANALYZED', 'AWS SAM resources are modeled without executing the SAM transform.', `Transform${transforms.length > 1 ? `[${index}]` : ''}`));
    else diagnostics.push(diagnostic(filename, 'warning', 'UNRESOLVED_TRANSFORM', `Transform ${name} is preserved but is not executed; dependency and quota analysis may be incomplete.`, `Transform${transforms.length > 1 ? `[${index}]` : ''}`));
  });
  nestedTransforms.forEach(({ name, path }) => diagnostics.push(diagnostic(filename, 'warning', 'UNRESOLVED_INLINE_TRANSFORM', `Inline transform ${name} is preserved but is not executed.`, path)));
  const state: ExpansionState = { count: 0, partial: transforms.some((name) => !knownTransforms.has(name)) || nestedTransforms.length > 0, filename, defaults: parametersWithDefaults(ast), diagnostics };
  const projectedResourceValues = expandValue(resources, 'Resources', state, 0);
  const projectedConditions = expandValue(isRecord(ast.Conditions) ? ast.Conditions : {}, 'Conditions', state, 0);
  const projectedOutputs = expandValue(isRecord(ast.Outputs) ? ast.Outputs : {}, 'Outputs', state, 0);
  const projectedResources: Record<string, ProjectedCloudFormationResource> = {};
  if (isRecord(projectedResourceValues)) {
    for (const [logicalId, resource] of Object.entries(projectedResourceValues)) {
      if (!isRecord(resource) || typeof resource.Type !== 'string') continue;
      const authored = logicalId in resources && isRecord(resources[logicalId]) && typeof (resources[logicalId] as Record<string, unknown>).Type === 'string';
      let loopName: string | undefined;
      let iterationValue: string | undefined;
      if (!authored) {
        for (const [key, declaration] of Object.entries(resources)) {
          if (!key.startsWith('Fn::ForEach::') || !Array.isArray(declaration)) continue;
          const identifier = typeof declaration[0] === 'string' ? declaration[0] : '';
          const values = collectionValues(declaration[1], state.defaults) ?? [];
          if (values.some((item) => JSON.stringify(substitute(declaration[2], identifier, item)).includes(`"${logicalId}"`))) {
            loopName = key.slice('Fn::ForEach::'.length);
            iterationValue = String(values.find((item) => JSON.stringify(substitute(declaration[2], identifier, item)).includes(`"${logicalId}"`)) ?? '');
            break;
          }
        }
      }
      projectedResources[logicalId] = {
        logicalId,
        resource,
        sourcePath: authored ? `Resources.${logicalId}` : `Resources.Fn::ForEach::${loopName ?? 'unknown'}`,
        origin: authored ? 'authored' : 'foreach',
        ...(loopName ? { loopName } : {}),
        ...(iterationValue ? { iterationValue } : {}),
      };
    }
  }
  const dialects = ['standard', ...(transforms.includes('AWS::LanguageExtensions') || hasForEach ? ['language-extensions'] : []), ...(hasSam ? ['sam'] : []), ...(hasCdk ? ['cdk'] : []), ...(transforms.some((name) => !knownTransforms.has(name)) || nestedTransforms.length ? ['macro'] : [])] as CloudFormationFidelityAnalysis['dialects'];
  return {
    dialects: [...new Set(dialects)],
    confidence: state.partial ? 'partial' : 'complete',
    transforms: transformRecords,
    projectedResources,
    projectedConditions: isRecord(projectedConditions) ? projectedConditions : {},
    projectedOutputs: isRecord(projectedOutputs) ? projectedOutputs : {},
    cdkConstructPaths,
    cdkHelperLogicalIds: cdkHelpers,
    transformDiagnostics: diagnostics,
  };
}

export interface ExpressionContext {
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly mappings?: Readonly<Record<string, unknown>>;
  readonly conditions?: Readonly<Record<string, boolean>>;
  readonly pseudoParameters?: Readonly<Record<string, string>>;
}

/** Evaluates only resource-independent intrinsic expressions with locally known values. */
export function evaluateStaticExpression(value: unknown, context: ExpressionContext = {}): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!isRecord(value)) return undefined;
  if (typeof value.Ref === 'string') {
    const resolved = context.parameters?.[value.Ref] ?? context.pseudoParameters?.[value.Ref];
    return resolved === undefined ? undefined : String(resolved);
  }
  if ('Fn::Join' in value && Array.isArray(value['Fn::Join'])) {
    const [delimiter, values] = value['Fn::Join'];
    if (typeof delimiter !== 'string' || !Array.isArray(values)) return undefined;
    const evaluated = values.map((entry) => evaluateStaticExpression(entry, context));
    return evaluated.some((entry) => entry === undefined) ? undefined : evaluated.join(delimiter);
  }
  if ('Fn::Sub' in value) {
    const raw = value['Fn::Sub'];
    const template = typeof raw === 'string' ? raw : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : undefined;
    const variables = Array.isArray(raw) && isRecord(raw[1]) ? raw[1] : {};
    if (!template) return undefined;
    let unresolved = false;
    const result = template.replace(/\$\{([A-Za-z0-9:_-]+)\}/g, (_match, name: string) => {
      const resolved = evaluateStaticExpression(variables[name], context) ?? evaluateStaticExpression({ Ref: name }, context);
      if (resolved === undefined) { unresolved = true; return `\${${name}}`; }
      return resolved;
    });
    return unresolved ? undefined : result;
  }
  if ('Fn::Select' in value && Array.isArray(value['Fn::Select'])) {
    const [rawIndex, rawValues] = value['Fn::Select'];
    const index = Number(evaluateStaticExpression(rawIndex, context));
    return Number.isInteger(index) && Array.isArray(rawValues) ? evaluateStaticExpression(rawValues[index], context) : undefined;
  }
  if ('Fn::FindInMap' in value && Array.isArray(value['Fn::FindInMap'])) {
    const [mapName, topKey, secondKey] = value['Fn::FindInMap'].map((entry) => evaluateStaticExpression(entry, context));
    const map = mapName ? context.mappings?.[mapName] : undefined;
    const row = isRecord(map) && topKey ? map[topKey] : undefined;
    return isRecord(row) && secondKey ? evaluateStaticExpression(row[secondKey], context) : undefined;
  }
  if ('Fn::If' in value && Array.isArray(value['Fn::If'])) {
    const [condition, yes, no] = value['Fn::If'];
    return typeof condition === 'string' && condition in (context.conditions ?? {}) ? evaluateStaticExpression(context.conditions?.[condition] ? yes : no, context) : undefined;
  }
  if ('Fn::Base64' in value) {
    const resolved = evaluateStaticExpression(value['Fn::Base64'], context);
    return resolved === undefined ? undefined : `base64:${resolved}`;
  }
  return undefined;
}

/** Returns a stable symbolic fingerprint for intrinsic expression matching. */
export function expressionFingerprint(value: unknown): string {
  return JSON.stringify(canonicalizeAst(value));
}

/** Canonicalizes object ordering and equivalent GetAtt spellings for semantic comparison. */
export function canonicalizeAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeAst);
  if (!isRecord(value)) return value;
  if (typeof value['Fn::GetAtt'] === 'string') {
    const [logicalId, ...attribute] = value['Fn::GetAtt'].split('.');
    return { 'Fn::GetAtt': [logicalId, attribute.join('.')] };
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeAst(value[key])]));
}

function diffAst(before: unknown, after: unknown, path: string, differences: Array<{ path: string; before?: unknown; after?: unknown; expected: boolean }>, expectedPaths: readonly string[]): void {
  if (JSON.stringify(canonicalizeAst(before)) === JSON.stringify(canonicalizeAst(after))) return;
  if (isRecord(before) && isRecord(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diffAst(before[key], after[key], path ? `${path}.${key}` : key, differences, expectedPaths);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    before.forEach((entry, index) => diffAst(entry, after[index], `${path}[${index}]`, differences, expectedPaths));
    return;
  }
  differences.push({ path: path || '$', ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), expected: expectedPaths.some((expected) => path === expected || path.startsWith(`${expected}.`) || path.startsWith(`${expected}[`)) });
}

/** Compares authored and generated ASTs while separating controlled edits from accidental loss. */
export function compareCanonicalAsts(templateId: string, filename: string, before: unknown, after: unknown, expectedPaths: readonly string[] = []): RoundTripComparison {
  const differences: Array<{ path: string; before?: unknown; after?: unknown; expected: boolean }> = [];
  diffAst(before, after, '', differences, expectedPaths);
  const status = differences.length === 0 ? 'exact' : differences.every((difference) => difference.expected) ? 'expected-differences' : 'unexpected-differences';
  return { templateId, filename, status, differences };
}

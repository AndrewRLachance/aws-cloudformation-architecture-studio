/**
 * @file CloudFormation source parsing and normalization.
 * @module cloudformation/parser
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file parses JSON and YAML templates, preserves intrinsic functions, and records import diagnostics.
 */
import { LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument, stringify, type Alias, type Document, type Pair } from 'yaml';
import type { CloudFormationImportDiagnostic, CloudFormationTemplateRecord, SourceLocation } from '../domain/types';
import { sha256Text, stableId } from '../domain/ids';
import { analyzeTemplateFidelity } from './fidelity';

/** Named text source supplied to the CloudFormation parser. */
export interface SourceFile {
  readonly name: string;
  readonly text: string;
}

/** Parser result containing an optional template record and diagnostics. */
export interface ParsedTemplate {
  readonly record?: CloudFormationTemplateRecord;
  readonly diagnostics: readonly CloudFormationImportDiagnostic[];
}

/** YAML short-form CloudFormation tags mapped to canonical intrinsic keys. */
const INTRINSIC_TAGS: Readonly<Record<string, string>> = {
  '!Ref': 'Ref',
  '!GetAtt': 'Fn::GetAtt',
  '!Sub': 'Fn::Sub',
  '!Join': 'Fn::Join',
  '!Select': 'Fn::Select',
  '!Split': 'Fn::Split',
  '!FindInMap': 'Fn::FindInMap',
  '!ImportValue': 'Fn::ImportValue',
  '!GetStackOutput': 'Fn::GetStackOutput',
  '!GetAZs': 'Fn::GetAZs',
  '!If': 'Fn::If',
  '!Equals': 'Fn::Equals',
  '!And': 'Fn::And',
  '!Or': 'Fn::Or',
  '!Not': 'Fn::Not',
  '!Base64': 'Fn::Base64',
  '!Cidr': 'Fn::Cidr',
  '!Transform': 'Fn::Transform',
  '!Condition': 'Condition',
};

/** Creates a stable CloudFormation import diagnostic object. */
function diagnostic(filename: string, severity: 'info' | 'warning' | 'error', code: string, message: string, blocking: boolean, extras: { line?: number; column?: number; path?: string } = {}): CloudFormationImportDiagnostic {
  return { id: stableId('diagnostic', filename, code, message, String(extras.line ?? ''), String(extras.column ?? '')), filename, severity, code, message, blocking, ...extras };
}

/** Checks whether an unknown value is a non-array object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts a YAML mapping pair key into a string. */
function pairKey(pair: Pair): string {
  const key = pair.key;
  if (isScalar(key)) return String(key.value);
  return String(key?.toString() ?? '');
}

/** Builds canonical-path source locations from YAML's concrete syntax ranges. JSON is valid YAML. */
function collectSourceLocations(text: string): Record<string, SourceLocation> {
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, merge: true, prettyErrors: false, strict: false });
  if (document.errors.length > 0) return {};
  const locations: Record<string, SourceLocation> = {};
  const locate = (node: unknown, path: string): void => {
    const ranged = node as { range?: readonly number[] } | null;
    if (path && !locations[path] && ranged?.range?.[0] !== undefined) {
      const start = lineCounter.linePos(ranged.range[0]);
      const endOffset = ranged.range[1];
      const end = endOffset === undefined ? undefined : lineCounter.linePos(endOffset);
      locations[path] = { line: start.line, column: start.col, ...(end ? { endLine: end.line, endColumn: end.col } : {}) };
    }
    if (isMap(node)) {
      for (const pair of node.items as Pair[]) {
        const key = pairKey(pair);
        const childPath = path ? `${path}.${key}` : key;
        const keyNode = pair.key as { range?: readonly number[] } | null;
        if (keyNode?.range?.[0] !== undefined) {
          const start = lineCounter.linePos(keyNode.range[0]);
          locations[childPath] = { line: start.line, column: start.col };
        }
        locate(pair.value, childPath);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item: unknown, index: number) => locate(item, `${path}[${index}]`));
    }
  };
  locate(document.contents, '');
  return locations;
}

/** Converts YAML AST nodes into JSON-like values while preserving intrinsics. */
function convertYamlNode(node: unknown, document: Document, aliasDepth = 0): unknown {
  if (node === null || node === undefined) return null;
  if (aliasDepth > 100) throw new Error('YAML alias expansion exceeded the safe depth limit.');
  if (isAlias(node)) {
    const resolved = (node as Alias).resolve(document);
    return convertYamlNode(resolved ?? null, document, aliasDepth + 1);
  }
  let value: unknown;
  if (isScalar(node)) {
    value = node.value;
  } else if (isSeq(node)) {
    value = node.items.map((item: unknown) => convertYamlNode(item, document, aliasDepth));
  } else if (isMap(node)) {
    value = Object.fromEntries((node.items as Pair[]).map((pair) => [pairKey(pair), convertYamlNode(pair.value, document, aliasDepth)]));
  } else {
    const fallback = node as { toJSON?: () => unknown };
    value = fallback.toJSON ? fallback.toJSON() : node;
  }
  const tagged = node as { tag?: unknown };
  const tag = typeof tagged.tag === 'string' ? tagged.tag : undefined;
  const intrinsic = tag ? INTRINSIC_TAGS[tag] : undefined;
  if (!intrinsic) return value;
  if (intrinsic === 'Fn::GetAtt' && typeof value === 'string') {
    const [logicalId, ...attribute] = value.split('.');
    value = [logicalId ?? value, attribute.join('.')];
  }
  return { [intrinsic]: value };
}

/** Extracts TemplateBody content from AWS CLI response envelopes. */
function unwrapTemplateEnvelope(value: unknown): unknown {
  if (!isRecord(value) || !('TemplateBody' in value)) return value;
  const body = value.TemplateBody;
  if (typeof body === 'string') return parseSourceText(body, '<TemplateBody>').value;
  return body;
}

/** Parses source text as JSON or YAML and returns diagnostics. */
function parseSourceText(text: string, filename: string): { value?: unknown; diagnostics: CloudFormationImportDiagnostic[]; format: 'yaml' | 'json' } {
  const trimmed = text.trim();
  const likelyJson = filename.toLowerCase().endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (likelyJson) {
    try {
      const value = JSON.parse(text) as unknown;
      const duplicateCheck = parseDocument(text, { prettyErrors: true, strict: true, uniqueKeys: true });
      const duplicate = duplicateCheck.errors.find((error) => error.code === 'DUPLICATE_KEY');
      if (duplicate) return { value, diagnostics: [diagnostic(filename, 'error', 'DUPLICATE_LOGICAL_ID', duplicate.message, false, { path: '$' })], format: 'json' };
      return { value, diagnostics: [], format: 'json' };
    } catch (error) {
      if (filename.toLowerCase().endsWith('.json')) {
        return { diagnostics: [diagnostic(filename, 'error', 'MALFORMED_JSON', error instanceof Error ? error.message : 'Malformed JSON.', true)], format: 'json' };
      }
    }
  }
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { lineCounter, merge: true, prettyErrors: true, strict: true });
  const diagnostics: CloudFormationImportDiagnostic[] = [];
  for (const error of document.errors) {
    const position = error.pos?.[0] === undefined ? undefined : lineCounter.linePos(error.pos[0]);
    diagnostics.push(diagnostic(filename, 'error', error.code, error.message, true, position ? { line: position.line, column: position.col } : {}));
  }
  for (const warning of document.warnings) {
    const position = warning.pos?.[0] === undefined ? undefined : lineCounter.linePos(warning.pos[0]);
    const isKnownIntrinsic = Object.keys(INTRINSIC_TAGS).some((tag) => warning.message.includes(tag));
    if (!isKnownIntrinsic) diagnostics.push(diagnostic(filename, 'warning', warning.code, warning.message, false, position ? { line: position.line, column: position.col } : {}));
  }
  if (document.errors.length > 0) return { diagnostics, format: 'yaml' };
  try {
    return { value: convertYamlNode(document.contents, document), diagnostics, format: 'yaml' };
  } catch (error) {
    diagnostics.push(diagnostic(filename, 'error', 'YAML_CONVERSION_FAILED', error instanceof Error ? error.message : 'Unable to convert YAML.', true));
    return { diagnostics, format: 'yaml' };
  }
}

/** Returns a named CloudFormation section when it is an object. */
function section(ast: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = ast[name];
  return isRecord(value) ? value : {};
}

/** Parses a CloudFormation source file into a normalized template record. */
export async function parseCloudFormationTemplate(file: SourceFile, associations: { stackId?: string; stackSetId?: string } = {}): Promise<ParsedTemplate> {
  const parsed = parseSourceText(file.text, file.name);
  if (parsed.value === undefined) return { diagnostics: parsed.diagnostics };
  const unwrapped = unwrapTemplateEnvelope(parsed.value);
  if (!isRecord(unwrapped)) {
    return { diagnostics: [...parsed.diagnostics, diagnostic(file.name, 'error', 'INVALID_TEMPLATE_ROOT', 'A CloudFormation template must be an object.', true, { path: '$' })] };
  }
  const resources = section(unwrapped, 'Resources');
  if (Object.keys(resources).length === 0) {
    return { diagnostics: [...parsed.diagnostics, diagnostic(file.name, 'error', 'MISSING_RESOURCES', 'The template does not contain a non-empty Resources object.', true, { path: '$.Resources' })] };
  }
  const knownKeys = new Set(['AWSTemplateFormatVersion','Description','Metadata','Parameters','Mappings','Conditions','Rules','Transform','Resources','Outputs','Hooks']);
  const unknownTopLevel = Object.fromEntries(Object.entries(unwrapped).filter(([key]) => !knownKeys.has(key)));
  const contentHash = await sha256Text(file.text);
  const sourceIdentity = `${file.name}:${contentHash}`;
  const unsupported: CloudFormationImportDiagnostic[] = [];
  const fidelity = analyzeTemplateFidelity(unwrapped, file.name);
  unsupported.push(...fidelity.transformDiagnostics);
  const id = stableId('template', sourceIdentity);
  const base = {
    id,
    originalFilename: file.name,
    originalFormat: parsed.format,
    originalSourceText: file.text,
    canonicalAst: unwrapped,
    parameters: section(unwrapped, 'Parameters'),
    mappings: section(unwrapped, 'Mappings'),
    conditions: section(unwrapped, 'Conditions'),
    rules: section(unwrapped, 'Rules'),
    metadata: section(unwrapped, 'Metadata'),
    resources,
    outputs: section(unwrapped, 'Outputs'),
    hooks: section(unwrapped, 'Hooks'),
    unknownTopLevel,
    importedAt: new Date().toISOString(),
    sourceIdentity,
    contentHash,
    parseDiagnostics: parsed.diagnostics,
    unsupportedFeatureDiagnostics: unsupported,
    sourceLocations: collectSourceLocations(file.text),
    fidelity,
  };
  const record: CloudFormationTemplateRecord = {
    ...base,
    ...(associations.stackId ? { stackId: associations.stackId } : {}),
    ...(associations.stackSetId ? { stackSetId: associations.stackSetId } : {}),
    ...(typeof unwrapped.Description === 'string' ? { description: unwrapped.Description } : {}),
    ...('Transform' in unwrapped ? { transform: unwrapped.Transform } : {}),
  };
  return { record, diagnostics: [...parsed.diagnostics, ...unsupported] };
}

/** Serializes a template AST as YAML or formatted JSON. */
export function stringifyTemplate(ast: Readonly<Record<string, unknown>>, format: 'yaml' | 'json'): string {
  if (format === 'json') return `${JSON.stringify(ast, null, 2)}\n`;
  return stringify(ast, { lineWidth: 0, sortMapEntries: false });
}

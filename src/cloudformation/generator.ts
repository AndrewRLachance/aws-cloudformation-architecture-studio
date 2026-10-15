/**
 * @file CloudFormation template generation from diagrams.
 * @module cloudformation/generator
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file synthesizes stack and StackSet templates, exports, manifests, and downloadable generation bundles.
 */
import { stringify } from 'yaml';
import type {
  DeploymentGroup,
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  GenerationError,
  GenerationManifest,
  GenerationWarning,
  RoundTripComparison,
  ValidationIssue,
} from '../domain/types';
import { compareCanonicalAsts } from './fidelity';
import { CLOUDFORMATION_LIMITS, validateCloudFormationDocument } from './validation';

/** Generated template artifact for a stack or StackSet owner. */
export interface GeneratedTemplate {
  readonly ownerId: string;
  readonly ownerKind: 'stack' | 'stackset' | 'nested-stack';
  readonly filename: string;
  readonly ast: Readonly<Record<string, unknown>>;
  readonly json: string;
  readonly yaml: string;
}
/** Complete CloudFormation generation output including artifacts and diagnostics. */
export interface GenerationResult {
  readonly templates: readonly GeneratedTemplate[];
  readonly stackInstanceManifest: Readonly<Record<string, unknown>>;
  readonly manifest: GenerationManifest;
  readonly warnings: readonly GenerationWarning[];
  readonly errors: readonly GenerationError[];
  readonly validationIssues: readonly ValidationIssue[];
  readonly roundTripComparisons: readonly RoundTripComparison[];
  readonly canExport: boolean;
}

/** Error thrown when CloudFormation artifacts would be semantically invalid. */
export class GenerationValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`CloudFormation export is blocked by ${issues.filter((issue) => issue.severity === 'error').length} validation error(s).`);
    this.name = 'GenerationValidationError';
  }
}

/** Internal mutable template accumulator used while synthesizing relationships. */
interface MutableTemplate {
  readonly ownerId: string;
  readonly ownerKind: 'stack' | 'stackset' | 'nested-stack';
  readonly group: DeploymentGroup;
  readonly filename: string;
  readonly ast: Record<string, unknown>;
  readonly resources: Record<string, unknown>;
}

/** Checks whether an unknown value is a non-array object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Converts a display name into a CloudFormation-compatible logical ID. */
function sanitizeLogicalId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `Resource${cleaned}`;
}
/** Makes a user-derived identifier safe as one ZIP path segment. */
function safePathSegment(value: string): string { return value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '') || 'artifact'; }
/** Returns the stack or StackSet owner for a node. */
function ownerId(node: DiagramNode | undefined): string | undefined {
  return node?.stackId ?? node?.stackSetId;
}
/** Deep-clones a record before mutating generated template output. */
function cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return structuredClone(value) as Record<string, unknown>;
}
/** Retrieves a preserved imported resource from its source template. */
function originalResource(document: DiagramDocument, templateId: string | undefined, logicalId: string | undefined): Record<string, unknown> | undefined {
  if (!templateId || !logicalId) return undefined;
  const raw = document.templatesById[templateId]?.resources[logicalId];
  return isRecord(raw) ? cloneRecord(raw) : undefined;
}
/** Removes intrinsic suffixes from a stored CloudFormation property path. */
function normalizePropertyPath(path: string): string {
  return path.replace(/\.(?:Ref|Fn::GetAtt|Fn::Sub|Fn::Join|Fn::ImportValue)$/, '');
}
/** Parses a dotted CloudFormation property path into object and array segments. */
function pathSegments(path: string): Array<string | number> {
  const segments: Array<string | number> = [];
  for (const part of path.split('.')) {
    const match = /^([^[]+)(.*)$/.exec(part);
    if (!match?.[1]) continue;
    segments.push(match[1]);
    for (const index of (match[2] ?? '').matchAll(/\[(\d+)\]/g)) segments.push(Number(index[1]));
  }
  return segments;
}
/** Writes a value into a generated template at a supported property path. */
function setPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const segments = pathSegments(normalizePropertyPath(path));
  if (segments.length < 4 || segments[0] !== 'Resources' || segments[2] !== 'Properties') return false;
  let current: unknown = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const next = segments[index + 1];
    if (segment === undefined) return false;
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return false;
      if (current[segment] === undefined) current[segment] = typeof next === 'number' ? [] : {};
      current = current[segment];
    } else {
      if (!isRecord(current)) return false;
      if (current[segment] === undefined) current[segment] = typeof next === 'number' ? [] : {};
      current = current[segment];
    }
  }
  const last = segments.at(-1);
  if (typeof last === 'number') {
    if (!Array.isArray(current)) return false;
    current[last] = value;
    return true;
  }
  if (!last || !isRecord(current)) return false;
  current[last] = value;
  return true;
}
/** Chooses the CloudFormation export name for a synthesized cross-stack edge. */
function exportName(edge: DiagramEdge, provider: MutableTemplate, targetLogicalId: string): string {
  const metadataName = edge.metadata.exportName;
  if (typeof metadataName === 'string' && metadataName.length > 0) return metadataName;
  if (edge.label && !edge.label.startsWith('Fn::') && edge.label !== 'Ref') return edge.label;
  return `${provider.group.name}-${targetLogicalId}`.replace(/[^A-Za-z0-9:_./-]/g, '-');
}
/** Builds a CloudFormation output logical ID for an exported resource value. */
function outputLogicalId(targetLogicalId: string, name: string): string {
  return sanitizeLogicalId(`${targetLogicalId}${name}Export`).slice(0, 240);
}

/** Produces a CloudFormation resource object from a diagram node. */
function resourceFromNode(document: DiagramDocument, node: DiagramNode): Record<string, unknown> | undefined {
  if (node.sourceProjection) return undefined;
  if (node.importStatus === 'removed') return undefined;
  const preserved = originalResource(document, node.sourceTemplateId, node.sourceLogicalId);
  const editable = node.kind === 'aws-resource' ? {
    type: node.cloudFormationType,
    properties: node.properties,
    condition: node.condition,
    metadata: node.metadata,
    deletionPolicy: node.deletionPolicy,
    updateReplacePolicy: node.updateReplacePolicy,
  } : node.kind === 'boundary' ? node.cloudFormation : undefined;
  if (!editable) return preserved;
  const resource: Record<string, unknown> = preserved ?? { Type: editable.type, Properties: cloneRecord(editable.properties) };
  resource.Type = editable.type;
  if ('Properties' in resource || Object.keys(editable.properties).length > 0) resource.Properties = cloneRecord(editable.properties);
  else delete resource.Properties;
  if (editable.condition) resource.Condition = editable.condition; else delete resource.Condition;
  if (editable.metadata) resource.Metadata = cloneRecord(editable.metadata); else delete resource.Metadata;
  if (editable.deletionPolicy) resource.DeletionPolicy = editable.deletionPolicy; else delete resource.DeletionPolicy;
  if (editable.updateReplacePolicy) resource.UpdateReplacePolicy = editable.updateReplacePolicy; else delete resource.UpdateReplacePolicy;
  return resource;
}

/** Emits DependsOn fields from dependency edges inside one generated template. */
function applyDependsOn(document: DiagramDocument, mutable: MutableTemplate): void {
  for (const nodeId of mutable.group.nodeIds) {
    const node = document.nodesById[nodeId];
    if (!node || node.importStatus === 'removed') continue;
    const logicalId = node.sourceLogicalId ?? (node.kind === 'aws-resource' ? sanitizeLogicalId(node.name) : undefined);
    if (!logicalId || !isRecord(mutable.resources[logicalId])) continue;
    const dependencies = document.edgeOrder
      .map((id) => document.edgesById[id])
      .filter((edge) => edge?.source === node.id && edge.relationshipType === 'depends-on')
      .map((edge) => document.nodesById[edge?.target ?? '']?.sourceLogicalId)
      .filter((id): id is string => Boolean(id));
    const resource = mutable.resources[logicalId] as Record<string, unknown>;
    if (dependencies.length === 1) resource.DependsOn = dependencies[0];
    else if (dependencies.length > 1) resource.DependsOn = dependencies;
    else if (!node.sourceTemplateId) delete resource.DependsOn;
  }
}

/** Emits same-stack references or cross-stack exports for a semantic edge. */
function synthesizeRelationship(
  document: DiagramDocument,
  edge: DiagramEdge,
  mutableByOwner: ReadonlyMap<string, MutableTemplate>,
  warnings: GenerationWarning[],
): void {
  if (edge.sourceTemplateId || !edge.sourcePropertyPath) return;
  const sourceNode = document.nodesById[edge.source];
  const targetNode = document.nodesById[edge.target];
  const sourceOwner = ownerId(sourceNode);
  const targetOwner = ownerId(targetNode);
  const sourceTemplate = sourceOwner ? mutableByOwner.get(sourceOwner) : undefined;
  const targetTemplate = targetOwner ? mutableByOwner.get(targetOwner) : undefined;
  const targetLogicalId = targetNode?.sourceLogicalId ?? (targetNode?.kind === 'aws-resource' ? sanitizeLogicalId(targetNode.name) : undefined);
  if (!sourceTemplate || !targetTemplate || !targetLogicalId) {
    warnings.push({ code: 'RELATIONSHIP_NOT_GENERATED', message: `Relationship ${edge.id} could not be emitted because stack ownership or a target logical ID is missing.`, edgeId: edge.id });
    return;
  }
  if (sourceOwner === targetOwner) {
    const value = edge.label === 'Fn::GetAtt'
      ? { 'Fn::GetAtt': [targetLogicalId, typeof edge.metadata.attribute === 'string' ? edge.metadata.attribute : 'Arn'] }
      : { Ref: targetLogicalId };
    if (!setPath(sourceTemplate.ast, edge.sourcePropertyPath, value)) warnings.push({ code: 'INVALID_SOURCE_PROPERTY_PATH', message: `Relationship ${edge.id} has an unsupported source property path.`, nodeId: sourceNode?.id, stackId: sourceOwner });
    return;
  }
  const name = exportName(edge, targetTemplate, targetLogicalId);
  const outputs = isRecord(targetTemplate.ast.Outputs) ? targetTemplate.ast.Outputs : {};
  const outputId = outputLogicalId(targetLogicalId, name);
  outputs[outputId] = { Value: { Ref: targetLogicalId }, Export: { Name: name } };
  targetTemplate.ast.Outputs = outputs;
  if (!setPath(sourceTemplate.ast, edge.sourcePropertyPath, { 'Fn::ImportValue': name })) warnings.push({ code: 'INVALID_SOURCE_PROPERTY_PATH', message: `Cross-stack relationship ${edge.id} has an unsupported source property path.`, nodeId: sourceNode?.id, stackId: sourceOwner });
}

/** Generates CloudFormation templates and a manifest from the current diagram. */
export function generateCloudFormation(document: DiagramDocument): GenerationResult {
  const warnings: GenerationWarning[] = [];
  const validationIssues = validateCloudFormationDocument(document);
  const errors: GenerationError[] = validationIssues.filter((issue) => issue.severity === 'error').map((issue) => ({ code: issue.code, message: issue.message, ...(issue.nodeId ? { nodeId: issue.nodeId } : {}), ...(issue.templateId ? { stackId: Object.values(document.deploymentGroupsById).find((group) => group.templateId === issue.templateId)?.id } : {}) }));
  const mutableTemplates: MutableTemplate[] = [];
  const groups = document.deploymentGroupOrder.map((id) => document.deploymentGroupsById[id]).filter((group): group is NonNullable<typeof group> => Boolean(group));
  for (const group of groups) {
    if (group.kind === 'nested-stack') {
      if (group.unresolvedTemplate || !group.templateId) {
        warnings.push({ code: 'NESTED_TEMPLATE_UNRESOLVED', message: `${group.name} has no associated local child template.`, stackId: group.id });
        continue;
      }
    }
    const sourceTemplate = group.templateId ? document.templatesById[group.templateId] : undefined;
    const ast: Record<string, unknown> = sourceTemplate
      ? cloneRecord(sourceTemplate.canonicalAst)
      : { AWSTemplateFormatVersion: '2010-09-09', Description: `Generated by AWS CloudFormation Architecture Studio for ${group.name}` };
    const resources: Record<string, unknown> = isRecord(ast.Resources) ? cloneRecord(ast.Resources) : {};
    const representedLogicalIds = new Set<string>();
    for (const nodeId of group.nodeIds) {
      const node = document.nodesById[nodeId];
      if (!node || node.sourceProjection) continue;
      const logicalId = node.sourceLogicalId ?? (node.kind === 'aws-resource' ? sanitizeLogicalId(node.name) : undefined);
      const resource = resourceFromNode(document, node);
      if (!logicalId || !resource) continue;
      representedLogicalIds.add(logicalId);
      resources[logicalId] = resource;
    }
    if (sourceTemplate) for (const projection of Object.values(sourceTemplate.fidelity.projectedResources)) if (projection.origin === 'authored' && !representedLogicalIds.has(projection.logicalId)) delete resources[projection.logicalId];
    if (Object.keys(resources).length === 0) warnings.push({ code: 'EMPTY_TEMPLATE', message: `${group.name} has no CloudFormation resources.`, stackId: group.id });
    ast.Resources = resources;
    const ownerKind = group.kind === 'stackset' ? 'stackset' : group.kind === 'nested-stack' ? 'nested-stack' : 'stack';
    const filename = `${group.name.replace(/[^A-Za-z0-9._-]+/g, '-')}.${sourceTemplate?.originalFormat ?? 'yaml'}`;
    mutableTemplates.push({ ownerId: group.id, ownerKind, group, filename, ast, resources });
  }
  const mutableByOwner = new Map(mutableTemplates.map((template) => [template.ownerId, template]));
  for (const mutable of mutableTemplates) applyDependsOn(document, mutable);
  for (const edgeId of document.edgeOrder) {
    const edge = document.edgesById[edgeId];
    if (!edge || !['references-resource', 'imports-cloudformation-output', 'associated-with', 'assumes-role', 'reads-from', 'writes-to'].includes(edge.relationshipType)) continue;
    synthesizeRelationship(document, edge, mutableByOwner, warnings);
  }
  const templates: GeneratedTemplate[] = mutableTemplates.map((template) => ({
    ownerId: template.ownerId,
    ownerKind: template.ownerKind,
    filename: template.filename,
    ast: template.ast,
    json: `${JSON.stringify(template.ast, null, 2)}\n`,
    yaml: stringify(template.ast, { lineWidth: 0, sortMapEntries: false }),
  }));
  for (const template of templates) {
    const bytes = new TextEncoder().encode(template.json).length;
    const sourceTemplateId = document.deploymentGroupsById[template.ownerId]?.templateId;
    if (bytes > CLOUDFORMATION_LIMITS.s3TemplateBodyBytes) {
      const item: ValidationIssue = { id: `generated-size-${template.ownerId}`, severity: 'error', code: 'GENERATED_TEMPLATE_TOO_LARGE', message: `${template.filename} is ${bytes} bytes; the S3-backed maximum is ${CLOUDFORMATION_LIMITS.s3TemplateBodyBytes}.`, path: '$', ...(sourceTemplateId ? { templateId: sourceTemplateId } : {}) };
      validationIssues.push(item); errors.push({ code: item.code, message: item.message, stackId: template.ownerId });
    } else if (bytes > CLOUDFORMATION_LIMITS.directTemplateBodyBytes && !validationIssues.some((item) => item.code === 'TEMPLATE_REQUIRES_S3' && item.templateId === sourceTemplateId)) {
      validationIssues.push({ id: `generated-direct-size-${template.ownerId}`, severity: 'warning', code: 'GENERATED_TEMPLATE_REQUIRES_S3', message: `${template.filename} is ${bytes} bytes and must be submitted through S3 rather than as a direct request body.`, path: '$', ...(sourceTemplateId ? { templateId: sourceTemplateId } : {}) });
      warnings.push({ code: 'GENERATED_TEMPLATE_REQUIRES_S3', message: `${template.filename} exceeds the direct request-body threshold.`, stackId: template.ownerId });
    }
  }
  const roundTripComparisons: RoundTripComparison[] = templates.flatMap((template) => {
    const group = document.deploymentGroupsById[template.ownerId];
    const source = group?.templateId ? document.templatesById[group.templateId] : undefined;
    if (!group || !source) return [];
    const expectedPaths = group.nodeIds.flatMap((nodeId) => {
      const node = document.nodesById[nodeId];
      return node?.sourceLogicalId && !node.sourceProjection ? [`Resources.${node.sourceLogicalId}`] : [];
    });
    const represented = new Set(group.nodeIds.map((nodeId) => document.nodesById[nodeId]?.sourceLogicalId).filter((logicalId): logicalId is string => Boolean(logicalId)));
    for (const projection of Object.values(source.fidelity.projectedResources)) if (projection.origin === 'authored' && !represented.has(projection.logicalId)) expectedPaths.push(`Resources.${projection.logicalId}`);
    if (document.edgeOrder.some((edgeId) => { const edge = document.edgesById[edgeId]; return edge && !edge.sourceTemplateId && (document.nodesById[edge.source]?.stackId === group.id || document.nodesById[edge.target]?.stackId === group.id); })) expectedPaths.push('Outputs');
    return [compareCanonicalAsts(source.id, source.originalFilename, source.canonicalAst, template.ast, expectedPaths)];
  });
  for (const comparison of roundTripComparisons.filter((item) => item.status === 'unexpected-differences')) {
    const message = `${comparison.filename} has ${comparison.differences.filter((difference) => !difference.expected).length} unexpected round-trip difference(s).`;
    errors.push({ code: 'SEMANTIC_ROUND_TRIP_LOSS', message });
    validationIssues.push({ id: `round-trip-${comparison.templateId}`, severity: 'error', code: 'SEMANTIC_ROUND_TRIP_LOSS', message, templateId: comparison.templateId, filename: comparison.filename });
  }
  const stackInstanceManifest = {
    schemaVersion: 1,
    instances: document.stackInstanceOrder.map((id) => document.stackInstancesById[id]).filter(Boolean),
  };
  const generatedAt = new Date().toISOString();
  const deploymentMetadataFiles = Object.values(document.deploymentGroupsById).flatMap((group) => group.kind === 'stack' ? group.deploymentMetadata.map((artifact, index) => `deployment-metadata/${safePathSegment(group.id)}/${index + 1}-${safePathSegment(artifact.kind)}.json`) : []);
  for (const source of Object.values(document.importSourcesById)) source.unassociatedDeploymentMetadata?.forEach((artifact, index) => deploymentMetadataFiles.push(`deployment-metadata/unassociated/${safePathSegment(source.id)}-${index + 1}-${safePathSegment(artifact.kind)}.json`));
  const manifest: GenerationManifest = {
    schemaVersion: 3,
    generatedAt,
    documentId: document.id,
    templates: templates.map((template) => {
      const group = document.deploymentGroupsById[template.ownerId];
      return {
        ownerId: template.ownerId,
        ownerKind: template.ownerKind,
        filename: template.filename,
        format: template.filename.endsWith('.json') ? 'json' : 'yaml',
        ...(group?.kind === 'stack' && group.accountId ? { accountId: group.accountId } : {}),
        ...(group?.kind === 'stack' && group.region ? { region: group.region } : {}),
        ...(group?.kind === 'nested-stack' ? { parentStackId: group.parentStackId, parentResourceNodeId: group.parentResourceNodeId, ...(document.nodesById[group.parentResourceNodeId]?.sourceLogicalId ? { parentLogicalId: document.nodesById[group.parentResourceNodeId]?.sourceLogicalId } : {}) } : {}),
      };
    }),
    stackSets: groups.filter((group) => group.kind === 'stackset').map((group) => ({
      stackSetId: group.id,
      ...(group.permissionModel ? { permissionModel: group.permissionModel } : {}),
      targetGroups: group.targetGroups,
      ...(group.operationPreferences ? { operationPreferences: group.operationPreferences } : {}),
    })),
    nestedStacks: groups.filter((group) => group.kind === 'nested-stack').map((group) => ({
      deploymentGroupId: group.id,
      parentStackId: group.parentStackId,
      parentResourceNodeId: group.parentResourceNodeId,
      ...(document.nodesById[group.parentResourceNodeId]?.sourceLogicalId ? { parentLogicalId: document.nodesById[group.parentResourceNodeId]?.sourceLogicalId } : {}),
      ...(group.templateId ? { templateId: group.templateId } : {}),
      ...(templates.find((template) => template.ownerId === group.id)?.filename ? { templateFilename: templates.find((template) => template.ownerId === group.id)?.filename } : {}),
      ...(group.templateUrl ? { templateUrl: group.templateUrl } : {}),
      unresolvedTemplate: group.unresolvedTemplate,
      associationConfirmed: group.associationConfirmed,
    })),
    ...(document.stackInstanceOrder.length > 0 ? { stackInstancesFilename: 'stack-instances.json' } : {}),
    warnings,
    errors,
    validationReportFilename: 'validation-report.json',
    roundTripReportFilename: 'round-trip-report.json',
    deploymentMetadataFiles,
    cloudAssemblies: Object.values(document.importSourcesById).flatMap((source) => source.cloudAssembly ? [{ sourceId: source.id, manifestVersion: source.cloudAssembly.manifestVersion, stackArtifactIds: source.cloudAssembly.artifacts.filter((artifact) => artifact.type === 'aws:cloudformation:stack').map((artifact) => artifact.id), assetManifestFiles: source.cloudAssembly.assetManifestFiles }] : []),
  };
  return { templates, stackInstanceManifest, manifest, warnings, errors, validationIssues, roundTripComparisons, canExport: errors.length === 0 };
}

/** Packages generated templates, manifests, and the diagram document into a ZIP blob. */
export async function createGenerationZip(document: DiagramDocument, onProgress?: (completed: number, total: number, message: string) => void): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const generated = generateCloudFormation(document);
  if (!generated.canExport) throw new GenerationValidationError(generated.validationIssues);
  const zip = new JSZip();
  const total = generated.templates.length + 6 + generated.manifest.deploymentMetadataFiles.length;
  let completed = 0;
  for (const template of generated.templates) {
    zip.file(template.filename, template.filename.endsWith('.json') ? template.json : template.yaml);
    completed += 1;
    onProgress?.(completed, total, `Added ${template.filename}.`);
  }
  zip.file('generation-manifest.json', JSON.stringify(generated.manifest, null, 2));
  zip.file('stack-instances.json', JSON.stringify(generated.stackInstanceManifest, null, 2));
  zip.file('diagram.json', JSON.stringify(document, null, 2));
  zip.file('validation-report.json', JSON.stringify(generated.validationIssues, null, 2));
  zip.file('round-trip-report.json', JSON.stringify(generated.roundTripComparisons, null, 2));
  for (const group of Object.values(document.deploymentGroupsById)) if (group.kind === 'stack') group.deploymentMetadata.forEach((artifact, index) => zip.file(`deployment-metadata/${safePathSegment(group.id)}/${index + 1}-${safePathSegment(artifact.kind)}.json`, JSON.stringify(artifact.payload, null, 2)));
  for (const source of Object.values(document.importSourcesById)) source.unassociatedDeploymentMetadata?.forEach((artifact, index) => zip.file(`deployment-metadata/unassociated/${safePathSegment(source.id)}-${index + 1}-${safePathSegment(artifact.kind)}.json`, JSON.stringify(artifact.payload, null, 2)));
  completed += 5 + generated.manifest.deploymentMetadataFiles.length;
  onProgress?.(completed, total, 'Compressing ZIP bundle.');
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, (metadata) => onProgress?.(completed + metadata.percent / 100, total, `Compressing ZIP bundle: ${Math.round(metadata.percent)}%.`));
}

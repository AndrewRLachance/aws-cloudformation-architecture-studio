/**
 * @file Diagram document schema validation and migration.
 * @module domain/schema
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file validates persisted documents, migrates legacy versions, and checks referential integrity.
 */
import { z } from 'zod';
import type { DiagramDocument, DiagramNode, DiagramEdge, ValidationIssue } from './types';
import { createEmptyDocument } from './defaults';
import { stableId } from './ids';
import { analyzeTemplateFidelity } from '../cloudformation/fidelity';

/** Zod schema for validating point values. */
const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
/** Zod schema for validating size values. */
const sizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });
/** Zod schema for validating node base values. */
const nodeBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  position: pointSchema,
  size: sizeSchema,
  physicalParentId: z.string().optional(),
  stackId: z.string().optional(),
  stackSetId: z.string().optional(),
  stackInstanceId: z.string().optional(),
  logicalGroupIds: z.array(z.string()),
  attachedControlIds: z.array(z.string()),
  securityGroupIds: z.array(z.string()),
  sourceTemplateId: z.string().optional(),
  sourceLogicalId: z.string().optional(),
  sourceResourceType: z.string().optional(),
  sourcePropertyPath: z.string().optional(),
  sourceProjection: z.object({ kind: z.literal('foreach'), loopName: z.string(), iterationValue: z.string(), sourcePath: z.string() }).optional(),
  cdkConstructPath: z.string().optional(),
  cdkHelper: z.boolean().optional(),
  locked: z.boolean(),
  pinned: z.boolean(),
  collapsed: z.boolean(),
  zIndex: z.number().int(),
  userMetadata: z.record(z.string(), z.unknown()),
  diagramTags: z.record(z.string(), z.string()),
  annotations: z.array(z.object({ id: z.string(), label: z.string(), body: z.string().optional(), tone: z.enum(['info','success','warning','critical','neutral']), color: z.string() })),
  importStatus: z.enum(['imported', 'changed', 'removed', 'manual']).optional(),
  placementConfidence: z.enum(['high', 'medium', 'low', 'unresolved']).optional(),
});

/** Zod schema for validating boundary node values. */
const boundaryNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('boundary'),
  boundaryType: z.enum(['organization', 'organizational-unit', 'account', 'region', 'vpc', 'availability-zone', 'subnet']),
  accountId: z.string().optional(),
  regionName: z.string().optional(),
  availabilityZoneName: z.string().optional(),
  cidr: z.string().optional(),
  cloudFormation: z.object({
    type: z.string(),
    properties: z.record(z.string(), z.unknown()),
    condition: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    deletionPolicy: z.string().optional(),
    updateReplacePolicy: z.string().optional(),
  }).optional(),
});
/** Zod schema for validating resource node values. */
const resourceNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('aws-resource'),
  resourceType: z.enum([
    'ec2','alb','nlb','ecs','eks','lambda','lambda-layer','step-functions','appsync','serverless-application','serverless-connector','api-gateway','rds','dynamodb','s3','sqs','sns','eventbridge','kinesis','elasticache','secrets-manager','ssm-parameter','cloudfront','route53','iam-role','iam-policy','security-group','route-table','nat-gateway','internet-gateway','vpc-endpoint','vpc-peering','transit-gateway','nested-stack','cloudformation-generic',
  ]),
  cloudFormationType: z.string(),
  properties: z.record(z.string(), z.unknown()),
  condition: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  deletionPolicy: z.string().optional(),
  updateReplacePolicy: z.string().optional(),
});
/** Zod schema for validating control node values. */
const controlNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('control'),
  controlType: z.enum(['service-control-policy', 'config-rule', 'guardrail', 'kms-key', 'waf', 'shield']),
  properties: z.record(z.string(), z.unknown()),
});
/** Zod schema for validating external node values. */
const externalNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('external-reference'),
  referenceType: z.enum(['cloudformation-export', 'arn', 'parameter', 'resource', 'principal', 'template-url']),
  referenceValue: z.string(),
  resolved: z.boolean(),
});
const textNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string(),
  style: z.object({ fontSize: z.number().positive(), fontWeight: z.enum(['normal','bold']), alignment: z.enum(['left','center','right']), color: z.string(), backgroundColor: z.string().optional() }),
});
const legendNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('legend'),
  title: z.string(),
  mode: z.enum(['automatic','manual']),
  entries: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional(), color: z.string(), symbol: z.string().optional() })),
});
/** Zod schema for validating diagram node values. */
export const diagramNodeSchema = z.discriminatedUnion('kind', [boundaryNodeSchema, resourceNodeSchema, controlNodeSchema, externalNodeSchema, textNodeSchema, legendNodeSchema]);

/** Zod schema for validating diagram edge values. */
export const diagramEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relationshipType: z.enum(['network-traffic','depends-on','imports-cloudformation-output','references-resource','assumes-role','trusts-principal','permits-access','denies-access','associated-with','routes-through','shares-through-aws-ram','publishes-event','subscribes-to-event','reads-from','writes-to','replicates-to','deploys-to','stackset-manages-stack-instance','nested-stack','external-unresolved-reference']),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  description: z.string().optional(),
  direction: z.enum(['forward','reverse','bidirectional','none']),
  protocol: z.string().optional(),
  port: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  sourcePropertyPath: z.string().optional(),
  sourceTemplateId: z.string().optional(),
  importProvenance: z.object({
    sourceId: z.string(), templateId: z.string().optional(), logicalId: z.string().optional(), propertyPath: z.string().optional(), importedAt: z.string(),
  }).optional(),
  validationStatus: z.enum(['valid','warning','error','unresolved']),
});

const deploymentGroupBaseSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), nodeIds: z.array(z.string()), description: z.string().optional(), metadata: z.record(z.string(), z.unknown()),
});
const deploymentMetadataArtifactSchema = z.object({ id: z.string(), kind: z.enum(['stack-policy','change-set','termination-protection','stack-drift','resource-drifts','unassociated']), originalFilename: z.string(), payload: z.unknown(), stackId: z.string().optional(), stackName: z.string().optional(), associationEvidence: z.enum(['manifest','stack-identity','single-stack','unassociated']).optional() });
const stackSetTargetGroupSchema = z.object({
  id: z.string().min(1), accounts: z.array(z.string()), organizationalUnitIds: z.array(z.string()), accountFilterType: z.enum(['NONE','UNION','INTERSECTION','DIFFERENCE']).optional(), regions: z.array(z.string()), parameterOverrides: z.record(z.string(), z.unknown()),
});
const stackSetOperationPreferencesSchema = z.object({
  concurrencyMode: z.enum(['STRICT_FAILURE_TOLERANCE','SOFT_FAILURE_TOLERANCE']).optional(), failureToleranceCount: z.number().int().optional(), failureTolerancePercentage: z.number().int().optional(), maxConcurrentCount: z.number().int().optional(), maxConcurrentPercentage: z.number().int().optional(), regionConcurrencyType: z.enum(['SEQUENTIAL','PARALLEL']).optional(), regionOrder: z.array(z.string()).optional(),
});
const deploymentGroupSchema = z.discriminatedUnion('kind', [
  deploymentGroupBaseSchema.extend({ kind: z.literal('stack'), accountId: z.string().optional(), region: z.string().optional(), templateId: z.string().optional(), status: z.string().optional(), parameters: z.record(z.string(), z.unknown()), outputs: z.record(z.string(), z.unknown()), tags: z.record(z.string(), z.string()), deploymentMetadata: z.array(deploymentMetadataArtifactSchema) }),
  deploymentGroupBaseSchema.extend({ kind: z.literal('stackset'), templateId: z.string().optional(), permissionModel: z.string().optional(), unresolvedTargets: z.boolean(), targetGroups: z.array(stackSetTargetGroupSchema), operationPreferences: stackSetOperationPreferencesSchema.optional() }),
  deploymentGroupBaseSchema.extend({ kind: z.literal('nested-stack'), parentStackId: z.string().min(1), parentResourceNodeId: z.string().min(1), templateUrl: z.string().optional(), templateId: z.string().optional(), parameters: z.record(z.string(), z.unknown()), unresolvedTemplate: z.boolean(), associationConfirmed: z.boolean() }),
]);
const sourceLocationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive(), endLine: z.number().int().positive().optional(), endColumn: z.number().int().positive().optional() });
const importDiagnosticSchema = z.object({ id: z.string(), filename: z.string(), severity: z.enum(['info','warning','error']), code: z.string(), message: z.string(), line: z.number().optional(), column: z.number().optional(), path: z.string().optional(), blocking: z.boolean() });
const fidelitySchema = z.object({
  dialects: z.array(z.enum(['standard','language-extensions','sam','cdk','macro'])), confidence: z.enum(['complete','partial']),
  transforms: z.array(z.object({ name: z.string(), path: z.string(), executionOrder: z.number().int().nonnegative(), scope: z.enum(['top-level','nested']), support: z.enum(['partial','preserved']) })),
  projectedResources: z.record(z.string(), z.object({ logicalId: z.string(), resource: z.record(z.string(), z.unknown()), sourcePath: z.string(), origin: z.enum(['authored','foreach']), loopName: z.string().optional(), iterationValue: z.string().optional() })),
  projectedConditions: z.record(z.string(), z.unknown()), projectedOutputs: z.record(z.string(), z.unknown()), cdkConstructPaths: z.record(z.string(), z.string()), cdkHelperLogicalIds: z.array(z.string()), transformDiagnostics: z.array(importDiagnosticSchema),
});
const templateRecordSchema = z.object({
  id: z.string().min(1), stackId: z.string().optional(), stackSetId: z.string().optional(), originalFilename: z.string(), originalFormat: z.enum(['yaml','json']), originalSourceText: z.string(), canonicalAst: z.record(z.string(), z.unknown()), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()), mappings: z.record(z.string(), z.unknown()), conditions: z.record(z.string(), z.unknown()), rules: z.record(z.string(), z.unknown()), transform: z.unknown().optional(), metadata: z.record(z.string(), z.unknown()), resources: z.record(z.string(), z.unknown()), outputs: z.record(z.string(), z.unknown()), hooks: z.record(z.string(), z.unknown()), unknownTopLevel: z.record(z.string(), z.unknown()), importedAt: z.string(), sourceIdentity: z.string(), contentHash: z.string(), parseDiagnostics: z.array(importDiagnosticSchema), unsupportedFeatureDiagnostics: z.array(importDiagnosticSchema), sourceLocations: z.record(z.string(), sourceLocationSchema), fidelity: fidelitySchema,
});

const commentSchema = z.object({
  id: z.string(), message: z.string(), resolved: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
  target: z.discriminatedUnion('kind', [z.object({ kind: z.literal('canvas'), position: pointSchema }), z.object({ kind: z.literal('node'), nodeId: z.string(), offset: pointSchema })]),
});
const savedFilterSchema = z.object({
  id: z.string(), name: z.string().min(1), criteria: z.object({ accountIds: z.array(z.string()), regions: z.array(z.string()), stackIds: z.array(z.string()), stackSetIds: z.array(z.string()), awsServices: z.array(z.string()), validationStatuses: z.array(z.enum(['valid','warning','error','unresolved'])) }),
});

/** Zod schema for the current version-six diagram document shape. */
const documentSchemaV6 = z.object({
  schemaVersion: z.literal(6),
  id: z.string(),
  metadata: z.object({ title: z.string(), description: z.string(), createdAt: z.string(), updatedAt: z.string() }),
  nodesById: z.record(z.string(), diagramNodeSchema),
  nodeOrder: z.array(z.string()),
  edgesById: z.record(z.string(), diagramEdgeSchema),
  edgeOrder: z.array(z.string()),
  commentsById: z.record(z.string(), commentSchema),
  commentOrder: z.array(z.string()),
  deploymentGroupsById: z.record(z.string(), deploymentGroupSchema),
  deploymentGroupOrder: z.array(z.string()),
  logicalGroupsById: z.record(z.string(), z.object({ id: z.string(), name: z.string(), nodeIds: z.array(z.string()), description: z.string().optional(), colorToken: z.string() })),
  logicalGroupOrder: z.array(z.string()),
  stackInstancesById: z.record(z.string(), z.object({ id: z.string(), stackSetId: z.string(), accountId: z.string(), region: z.string(), stackId: z.string().optional(), status: z.string().optional(), driftStatus: z.string().optional(), parameterOverrides: z.record(z.string(), z.unknown()), lastOperationId: z.string().optional() })),
  stackInstanceOrder: z.array(z.string()),
  templatesById: z.record(z.string(), templateRecordSchema),
  templateOrder: z.array(z.string()),
  importSourcesById: z.record(z.string(), z.object({ id: z.string(), sourceIdentity: z.string(), filenames: z.array(z.string()), importType: z.enum(['single-stack','stack-bundle','multi-stack','stackset','reimport']), importedAt: z.string(), contentHashes: z.array(z.string()), cloudAssembly: z.object({ manifestVersion: z.string(), artifacts: z.array(z.object({ id: z.string(), type: z.string(), templateFile: z.string().optional(), displayName: z.string().optional(), environment: z.string().optional(), dependencies: z.array(z.string()) })), assetManifestFiles: z.array(z.string()) }).optional(), unassociatedDeploymentMetadata: z.array(deploymentMetadataArtifactSchema).optional() })),
  importSourceOrder: z.array(z.string()),
  savedFiltersById: z.record(z.string(), savedFilterSchema),
  savedFilterOrder: z.array(z.string()),
  activeFilterId: z.string().optional(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  preferences: z.object({
    snapToGrid: z.boolean(), gridSize: z.number().int().min(1).max(256), keyboardMoveIncrement: z.number().int().min(1).max(256), autosave: z.boolean(), reducedMotion: z.boolean(), layoutDirection: z.enum(['RIGHT','DOWN']), layoutDensity: z.enum(['compact','balanced','spacious']),
  }),
  visibleLayers: z.record(z.string(), z.boolean()),
  currentViewMode: z.enum(['infrastructure','deployment','security','cloudformation-source']),
  layoutPreferences: z.object({ algorithm: z.literal('layered'), onlyUnpositioned: z.boolean(), epsilon: z.number().nonnegative() }),
  importProvenance: z.record(z.string(), z.unknown()).optional(),
  revision: z.object({ number: z.number().int().nonnegative(), lastCommand: z.string(), updatedAt: z.string() }),
});

/** Minimal version-one document shape accepted by migration. */
interface LegacyV1 {
  schemaVersion: 1;
  id?: string;
  title?: string;
  nodes?: DiagramNode[];
  edges?: DiagramEdge[];
}
/** Version-two document shape accepted by migration. */
interface LegacyV2 {
  schemaVersion: 2;
  id: string;
  metadata: DiagramDocument['metadata'];
  nodesById: Record<string, DiagramNode>;
  nodeOrder: string[];
  edgesById: Record<string, DiagramEdge>;
  edgeOrder: string[];
}

/** Version-three document shape accepted by migration. */
interface LegacyV3 extends Omit<DiagramDocument, 'schemaVersion'> {
  schemaVersion: 3;
}

/** Error thrown when a document cannot be migrated or validated. */
export class DocumentValidationError extends Error {
  constructor(message: string, readonly issues: readonly string[]) {
    super(message);
    this.name = 'DocumentValidationError';
  }
}

/** Migrates older architecture document shapes to the current schema version. */
export function migrateDocument(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || !('schemaVersion' in input)) {
    throw new DocumentValidationError('The file is not a versioned architecture document.', ['Missing schemaVersion.']);
  }
  const version = (input as { schemaVersion: unknown }).schemaVersion;
  if (typeof version !== 'number') throw new DocumentValidationError('Invalid schema version.', ['schemaVersion must be a number.']);
  if (version > 6) throw new DocumentValidationError(`Document schema version ${version} is newer than this application supports.`, ['Supported maximum schemaVersion is 6.']);
  if (version === 6) return input;
  if (version === 5) {
    const legacy = input as Omit<DiagramDocument, 'schemaVersion'> & { schemaVersion: 5; preferences: Omit<DiagramDocument['preferences'], 'keyboardMoveIncrement'> };
    const nodesById = Object.fromEntries(Object.entries(legacy.nodesById).map(([id, node]) => [id, { ...node, diagramTags: node.diagramTags ?? {}, annotations: node.annotations ?? [] }]));
    return {
      ...legacy,
      schemaVersion: 6,
      nodesById,
      commentsById: {},
      commentOrder: [],
      savedFiltersById: {},
      savedFilterOrder: [],
      preferences: { ...legacy.preferences, keyboardMoveIncrement: 8 },
      visibleLayers: { ...legacy.visibleLayers, 'review-comments': true },
    } satisfies DiagramDocument;
  }
  if (version === 4) {
    const legacy = input as Omit<DiagramDocument, 'schemaVersion'> & { schemaVersion: 4 };
    const templatesById = Object.fromEntries(Object.entries(legacy.templatesById).map(([id, template]) => [id, { ...template, fidelity: template.fidelity ?? analyzeTemplateFidelity(template.canonicalAst, template.originalFilename) }]));
    const deploymentGroupsById = Object.fromEntries(Object.entries(legacy.deploymentGroupsById).map(([id, group]) => [id, group.kind === 'stack' ? { ...group, deploymentMetadata: group.deploymentMetadata ?? [] } : group]));
    return migrateDocument({ ...legacy, schemaVersion: 5, templatesById, deploymentGroupsById });
  }
  if (version === 3) {
    const legacy = input as LegacyV3;
    const templatesById = Object.fromEntries(Object.entries(legacy.templatesById).map(([id, template]) => [id, { ...template, sourceLocations: template.sourceLocations ?? {} }]));
    const nodesById = Object.fromEntries(Object.entries(legacy.nodesById).map(([id, node]) => {
      if (node.kind !== 'boundary' || !node.sourceTemplateId || !node.sourceLogicalId || node.cloudFormation) return [id, node];
      const raw = templatesById[node.sourceTemplateId]?.resources[node.sourceLogicalId];
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [id, node];
      const resource = raw as Record<string, unknown>;
      if (typeof resource.Type !== 'string') return [id, node];
      const properties = typeof resource.Properties === 'object' && resource.Properties !== null && !Array.isArray(resource.Properties) ? resource.Properties as Record<string, unknown> : {};
      return [id, {
        ...node,
        cloudFormation: {
          type: resource.Type,
          properties,
          ...(typeof resource.Condition === 'string' ? { condition: resource.Condition } : {}),
          ...(typeof resource.Metadata === 'object' && resource.Metadata !== null && !Array.isArray(resource.Metadata) ? { metadata: resource.Metadata as Record<string, unknown> } : {}),
          ...(typeof resource.DeletionPolicy === 'string' ? { deletionPolicy: resource.DeletionPolicy } : {}),
          ...(typeof resource.UpdateReplacePolicy === 'string' ? { updateReplacePolicy: resource.UpdateReplacePolicy } : {}),
        },
      }];
    }));
    const deploymentGroupsById = Object.fromEntries(Object.entries(legacy.deploymentGroupsById).map(([id, group]) => {
      if (group.kind === 'stackset') return [id, { ...group, targetGroups: group.targetGroups ?? [] }];
      if (group.kind === 'nested-stack') return [id, { ...group, parentResourceNodeId: group.parentResourceNodeId ?? group.nodeIds[0] ?? '', associationConfirmed: group.associationConfirmed ?? Boolean(group.templateId) }];
      return [id, group];
    }));
    return migrateDocument({ ...legacy, schemaVersion: 4, templatesById, nodesById, deploymentGroupsById });
  }
  if (version === 1) {
    const legacy = input as LegacyV1;
    const base = createEmptyDocument(legacy.title ?? 'Migrated architecture');
    const nodes = legacy.nodes ?? [];
    const edges = legacy.edges ?? [];
    return {
      ...base,
      id: legacy.id ?? base.id,
      nodesById: Object.fromEntries(nodes.map((node) => [node.id, { ...node, diagramTags: node.diagramTags ?? {}, annotations: node.annotations ?? [] }])),
      nodeOrder: nodes.map((node) => node.id),
      edgesById: Object.fromEntries(edges.map((edge) => [edge.id, edge])),
      edgeOrder: edges.map((edge) => edge.id),
      revision: { number: 1, lastCommand: 'migrate-v1', updatedAt: new Date().toISOString() },
    } satisfies DiagramDocument;
  }
  const legacy = input as LegacyV2;
  const base = createEmptyDocument(legacy.metadata.title);
  return {
    ...base,
    id: legacy.id,
    metadata: legacy.metadata,
    nodesById: Object.fromEntries(Object.entries(legacy.nodesById).map(([id, node]) => [id, { ...node, diagramTags: node.diagramTags ?? {}, annotations: node.annotations ?? [] }])),
    nodeOrder: legacy.nodeOrder,
    edgesById: legacy.edgesById,
    edgeOrder: legacy.edgeOrder,
    revision: { number: 1, lastCommand: 'migrate-v2', updatedAt: new Date().toISOString() },
  } satisfies DiagramDocument;
}

/** Validates and returns a versioned architecture document. */
export function parseDiagramDocument(input: unknown): DiagramDocument {
  const migrated = migrateDocument(input);
  const result = documentSchemaV6.safeParse(migrated);
  if (!result.success) {
    throw new DocumentValidationError('The architecture document is malformed.', result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const document = result.data as unknown as DiagramDocument;
  const integrity = validateReferentialIntegrity(document);
  const errors = integrity.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new DocumentValidationError('The architecture document contains broken references.', errors.map((issue) => issue.message));
  return document;
}

/** Checks node ordering, containment, and edge endpoint references. */
export function validateReferentialIntegrity(document: DiagramDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(Object.keys(document.nodesById));
  const deploymentGroupIds = new Set(Object.keys(document.deploymentGroupsById));
  const templateIds = new Set(Object.keys(document.templatesById));
  for (const id of document.nodeOrder) {
    if (!nodeIds.has(id)) issues.push({ id: stableId('issue','missing-node-order',id), severity: 'error', code: 'NODE_ORDER_MISSING', message: `Node order references missing node ${id}.`, path: `nodeOrder` });
  }
  for (const node of Object.values(document.nodesById)) {
    if (node.physicalParentId && !nodeIds.has(node.physicalParentId)) issues.push({ id: stableId('issue','missing-parent',node.id), severity: 'error', code: 'MISSING_PARENT', message: `${node.name} references missing physical parent ${node.physicalParentId}.`, nodeId: node.id });
    if (node.physicalParentId === node.id) issues.push({ id: stableId('issue','self-parent',node.id), severity: 'error', code: 'SELF_PARENT', message: `${node.name} cannot contain itself.`, nodeId: node.id });
    if (node.stackId && !deploymentGroupIds.has(node.stackId)) issues.push({ id: stableId('issue','missing-stack',node.id), severity: 'error', code: 'MISSING_STACK', message: `${node.name} references missing stack ${node.stackId}.`, nodeId: node.id });
    if (node.stackSetId && !deploymentGroupIds.has(node.stackSetId)) issues.push({ id: stableId('issue','missing-stackset',node.id), severity: 'error', code: 'MISSING_STACKSET', message: `${node.name} references missing StackSet ${node.stackSetId}.`, nodeId: node.id });
    if (node.sourceTemplateId && !templateIds.has(node.sourceTemplateId)) issues.push({ id: stableId('issue','missing-source-template',node.id), severity: 'error', code: 'MISSING_SOURCE_TEMPLATE', message: `${node.name} references missing source template ${node.sourceTemplateId}.`, nodeId: node.id });
  }
  for (const edge of Object.values(document.edgesById)) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) issues.push({ id: stableId('issue','edge-endpoint',edge.id), severity: 'error', code: 'MISSING_EDGE_ENDPOINT', message: `Edge ${edge.id} references a missing endpoint.`, edgeId: edge.id });
  }
  for (const id of document.commentOrder) if (!document.commentsById[id]) issues.push({ id: stableId('issue','missing-comment-order',id), severity: 'error', code: 'COMMENT_ORDER_MISSING', message: `Comment order references missing comment ${id}.`, path: 'commentOrder' });
  for (const comment of Object.values(document.commentsById)) if (comment.target.kind === 'node' && !nodeIds.has(comment.target.nodeId)) issues.push({ id: stableId('issue','missing-comment-target',comment.id), severity: 'error', code: 'MISSING_COMMENT_TARGET', message: `Comment ${comment.id} references missing node ${comment.target.nodeId}.`, path: `commentsById.${comment.id}.target` });
  for (const id of document.savedFilterOrder) if (!document.savedFiltersById[id]) issues.push({ id: stableId('issue','missing-filter-order',id), severity: 'error', code: 'FILTER_ORDER_MISSING', message: `Saved filter order references missing filter ${id}.`, path: 'savedFilterOrder' });
  if (document.activeFilterId && !document.savedFiltersById[document.activeFilterId]) issues.push({ id: stableId('issue','missing-active-filter',document.activeFilterId), severity: 'error', code: 'MISSING_ACTIVE_FILTER', message: `Active filter ${document.activeFilterId} does not exist.`, path: 'activeFilterId' });
  for (const id of document.deploymentGroupOrder) if (!deploymentGroupIds.has(id)) issues.push({ id: stableId('issue','missing-deployment-order',id), severity: 'error', code: 'DEPLOYMENT_ORDER_MISSING', message: `Deployment group order references missing group ${id}.`, path: 'deploymentGroupOrder' });
  for (const group of Object.values(document.deploymentGroupsById)) {
    for (const nodeId of group.nodeIds) if (!nodeIds.has(nodeId)) issues.push({ id: stableId('issue','missing-group-node',group.id,nodeId), severity: 'error', code: 'MISSING_GROUP_NODE', message: `${group.name} references missing member node ${nodeId}.`, path: `deploymentGroupsById.${group.id}.nodeIds` });
    if (group.templateId && !templateIds.has(group.templateId)) issues.push({ id: stableId('issue','missing-group-template',group.id), severity: 'error', code: 'MISSING_GROUP_TEMPLATE', message: `${group.name} references missing template ${group.templateId}.`, path: `deploymentGroupsById.${group.id}.templateId` });
    if (group.kind === 'nested-stack') {
      if (!deploymentGroupIds.has(group.parentStackId)) issues.push({ id: stableId('issue','missing-parent-stack',group.id), severity: 'error', code: 'MISSING_PARENT_STACK', message: `${group.name} references missing parent stack ${group.parentStackId}.`, path: `deploymentGroupsById.${group.id}.parentStackId` });
      if (!nodeIds.has(group.parentResourceNodeId)) issues.push({ id: stableId('issue','missing-parent-resource',group.id), severity: 'error', code: 'MISSING_PARENT_RESOURCE', message: `${group.name} references missing parent resource ${group.parentResourceNodeId}.`, path: `deploymentGroupsById.${group.id}.parentResourceNodeId` });
    }
  }
  for (const id of document.templateOrder) if (!templateIds.has(id)) issues.push({ id: stableId('issue','missing-template-order',id), severity: 'error', code: 'TEMPLATE_ORDER_MISSING', message: `Template order references missing template ${id}.`, path: 'templateOrder' });
  for (const instance of Object.values(document.stackInstancesById)) if (!deploymentGroupIds.has(instance.stackSetId)) issues.push({ id: stableId('issue','missing-instance-stackset',instance.id), severity: 'error', code: 'MISSING_INSTANCE_STACKSET', message: `StackSet instance ${instance.id} references missing StackSet ${instance.stackSetId}.`, path: `stackInstancesById.${instance.id}.stackSetId` });
  return issues;
}

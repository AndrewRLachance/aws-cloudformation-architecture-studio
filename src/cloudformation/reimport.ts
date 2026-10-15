/**
 * @file CloudFormation reimport reconciliation.
 * @module cloudformation/reimport
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file compares existing imported resources with incoming plans and preserves manual diagram edits.
 */
import type {
  CloudFormationImportPlan,
  CloudFormationTemplateRecord,
  DeploymentGroup,
  DiagramDocument,
  DiagramNode,
  ReimportChangeSet,
  PropertyChange,
  ResourceReimportDiff,
} from '../domain/types';
import { stableId } from '../domain/ids';

/** Returns the stack or StackSet owner for a node. */
function ownerId(node: DiagramNode): string | undefined {
  return node.stackId ?? node.stackSetId;
}

/** Builds a stable semantic key for an imported CloudFormation resource. */
function resourceKey(node: DiagramNode): string | undefined {
  const owner = ownerId(node);
  if (!owner || !node.sourceLogicalId || !node.sourceResourceType) return undefined;
  return `${owner}|${node.sourceLogicalId}|${node.sourceResourceType}`;
}

/** Serializes the CloudFormation-relevant semantics of a node for comparison. */
function semanticNodeValue(node: DiagramNode, templates: Readonly<Record<string, CloudFormationTemplateRecord>>): unknown {
  const raw = node.sourceTemplateId && node.sourceLogicalId ? templates[node.sourceTemplateId]?.resources[node.sourceLogicalId] : undefined;
  const preserved = isRecord(raw) ? structuredClone(raw) as Record<string, unknown> : {};
  const editable = node.kind === 'aws-resource' ? { type: node.cloudFormationType, properties: node.properties, condition: node.condition, metadata: node.metadata, deletionPolicy: node.deletionPolicy, updateReplacePolicy: node.updateReplacePolicy }
    : node.kind === 'boundary' ? node.cloudFormation : undefined;
  if (editable) {
    preserved.Type = editable.type; preserved.Properties = structuredClone(editable.properties);
    if (editable.condition) preserved.Condition = editable.condition; else delete preserved.Condition;
    if (editable.metadata) preserved.Metadata = structuredClone(editable.metadata); else delete preserved.Metadata;
    if (editable.deletionPolicy) preserved.DeletionPolicy = editable.deletionPolicy; else delete preserved.DeletionPolicy;
    if (editable.updateReplacePolicy) preserved.UpdateReplacePolicy = editable.updateReplacePolicy; else delete preserved.UpdateReplacePolicy;
    return preserved;
  }
  if (raw !== undefined) return raw;
  return { kind: node.kind, name: node.name };
}

/** Serializes the CloudFormation-relevant semantics of a node for comparison. */
function semanticNode(node: DiagramNode, templates: Readonly<Record<string, CloudFormationTemplateRecord>>): string {
  return JSON.stringify(semanticNodeValue(node, templates));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively calculates property-level additions, removals, and replacements. */
function diffValues(before: unknown, after: unknown, path = '$'): PropertyChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: PropertyChange[] = [];
    for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
      if (index >= before.length) changes.push({ path: `${path}[${index}]`, kind: 'added', after: after[index] });
      else if (index >= after.length) changes.push({ path: `${path}[${index}]`, kind: 'removed', before: before[index] });
      else changes.push(...diffValues(before[index], after[index], `${path}[${index}]`));
    }
    return changes;
  }
  if (isRecord(before) && isRecord(after)) {
    const changes: PropertyChange[] = [];
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      if (!(key in before)) changes.push({ path: `${path}.${key}`, kind: 'added', after: after[key] });
      else if (!(key in after)) changes.push({ path: `${path}.${key}`, kind: 'removed', before: before[key] });
      else changes.push(...diffValues(before[key], after[key], `${path}.${key}`));
    }
    return changes;
  }
  return [{ path, kind: 'changed', before, after }];
}

/** Builds a stable fingerprint for comparing semantic edges. */
function edgeFingerprint(edge: { source: string; target: string; relationshipType: string; sourcePropertyPath?: string }): string {
  return `${edge.source}|${edge.target}|${edge.relationshipType}|${edge.sourcePropertyPath ?? ''}`;
}

/** Lists changed keys between two metadata records with a label prefix. */
function changedRecordKeys(prefix: string, previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys]
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .sort()
    .map((key) => `${prefix}.${key}`);
}

/** Indexes templates from an import plan by template identifier. */
function incomingTemplates(plan: CloudFormationImportPlan): Record<string, CloudFormationTemplateRecord> {
  return Object.fromEntries(plan.templates.map((template) => [template.id, template]));
}

/** Collects changed stack parameters and outputs for a reimport plan. */
function groupChangeKeys(document: DiagramDocument, planGroups: readonly DeploymentGroup[]): { parameters: string[]; outputs: string[] } {
  const parameters: string[] = [];
  const outputs: string[] = [];
  for (const incoming of planGroups) {
    const existing = document.deploymentGroupsById[incoming.id];
    if (incoming.kind !== 'stack' || existing?.kind !== 'stack') continue;
    parameters.push(...changedRecordKeys(`${incoming.id}.Parameters`, existing.parameters, incoming.parameters));
    outputs.push(...changedRecordKeys(`${incoming.id}.Outputs`, existing.outputs, incoming.outputs));
  }
  return { parameters, outputs };
}

/** Calculates semantic additions, removals, and changes for a reimport plan. */
export function calculateReimportChangeSet(document: DiagramDocument, plan: CloudFormationImportPlan): ReimportChangeSet {
  const existing = new Map<string, DiagramNode>();
  for (const node of Object.values(document.nodesById)) {
    const key = resourceKey(node);
    if (key) existing.set(key, node);
  }
  const incoming = new Map<string, DiagramNode>();
  for (const node of plan.nodes) {
    const key = resourceKey(node);
    if (key) incoming.set(key, node);
  }
  const planTemplates = incomingTemplates(plan);
  const addedResourceKeys = [...incoming.keys()].filter((key) => !existing.has(key));
  const removedResourceKeys = [...existing.keys()].filter((key) => !incoming.has(key));
  const changedResourceKeys = [...incoming.keys()].filter((key) => {
    const previous = existing.get(key);
    const next = incoming.get(key);
    return previous && next && semanticNode(next, planTemplates) !== semanticNode(previous, document.templatesById);
  });
  const existingEdges = new Set(Object.values(document.edgesById).map(edgeFingerprint));
  const incomingEdges = new Set(plan.edges.map(edgeFingerprint));
  const changedInstances = plan.stackInstances
    .filter((instance) => {
      const current = document.stackInstancesById[instance.id];
      return !current || JSON.stringify(current) !== JSON.stringify(instance);
    })
    .map((instance) => instance.id);
  const groupChanges = groupChangeKeys(document, plan.deploymentGroups);
  const resourceDiffs: ResourceReimportDiff[] = [...new Set([...existing.keys(), ...incoming.keys()])].sort().flatMap((key) => {
    const previous = existing.get(key);
    const next = incoming.get(key);
    const representative = next ?? previous;
    if (!representative?.sourceLogicalId || !representative.sourceResourceType) return [];
    const before = previous ? semanticNodeValue(previous, document.templatesById) : undefined;
    const after = next ? semanticNodeValue(next, planTemplates) : undefined;
    if (previous && next && JSON.stringify(before) === JSON.stringify(after)) return [];
    const kind: ResourceReimportDiff['kind'] = !previous ? 'added' : !next ? 'removed' : 'changed';
    return [{ resourceKey: key, logicalId: representative.sourceLogicalId, resourceType: representative.sourceResourceType, kind, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}), propertyChanges: kind === 'changed' ? diffValues(before, after) : [] }];
  });
  return {
    addedResourceKeys,
    removedResourceKeys,
    changedResourceKeys,
    addedEdgeFingerprints: [...incomingEdges].filter((value) => !existingEdges.has(value)),
    removedEdgeFingerprints: [...existingEdges].filter((value) => !incomingEdges.has(value)),
    changedParameters: groupChanges.parameters,
    changedOutputs: groupChanges.outputs,
    changedStackInstances: changedInstances,
    resourceDiffs,
  };
}

/** Policy for handling previously imported resources missing from a reimport. */
export type RemovedResourcePolicy = 'remove' | 'detach' | 'mark-removed';

/** Default and per-resource removal choices from the graphical conflict workflow. */
export interface RemovedResourcePolicySelection {
  readonly defaultPolicy: RemovedResourcePolicy;
  readonly byResourceKey: Readonly<Record<string, RemovedResourcePolicy>>;
}

/** Preserves existing manual edits while reconciling a new import plan. */
export function reconcileImportPlan(document: DiagramDocument, plan: CloudFormationImportPlan, removedPolicy: RemovedResourcePolicy | RemovedResourcePolicySelection): CloudFormationImportPlan {
  const changeSet = calculateReimportChangeSet(document, plan);
  const affectedOwners = new Set(plan.deploymentGroups.map((group) => group.id));
  const existingByLogical = new Map<string, DiagramNode>();
  for (const node of Object.values(document.nodesById)) {
    const owner = ownerId(node);
    if (node.sourceLogicalId && owner && affectedOwners.has(owner)) {
      existingByLogical.set(`${owner}|${node.sourceLogicalId}|${node.sourceResourceType ?? ''}`, node);
    }
  }
  const planTemplateMap = incomingTemplates(plan);
  const reconciledNodes = plan.nodes.map((node) => {
    const owner = ownerId(node);
    if (!node.sourceLogicalId || !owner) return node;
    const existing = existingByLogical.get(`${owner}|${node.sourceLogicalId}|${node.sourceResourceType ?? ''}`);
    if (!existing) return node;
    return {
      ...node,
      id: existing.id,
      position: existing.position,
      physicalParentId: existing.physicalParentId,
      logicalGroupIds: existing.logicalGroupIds,
      attachedControlIds: existing.attachedControlIds,
      securityGroupIds: existing.securityGroupIds,
      locked: existing.locked,
      pinned: existing.pinned,
      collapsed: existing.collapsed,
      zIndex: existing.zIndex,
      userMetadata: existing.userMetadata,
      importStatus: semanticNode(existing, document.templatesById) === semanticNode(node, planTemplateMap) ? 'imported' : 'changed',
    } as DiagramNode;
  });
  const incomingKeys = new Set(reconciledNodes.map(resourceKey).filter((key): key is string => Boolean(key)));
  const removedNodes = Object.values(document.nodesById).filter((node) => {
    const owner = ownerId(node);
    const key = resourceKey(node);
    return Boolean(node.sourceTemplateId && owner && affectedOwners.has(owner) && key && !incomingKeys.has(key));
  });
  const policyFor = (node: DiagramNode): RemovedResourcePolicy => {
    if (typeof removedPolicy === 'string') return removedPolicy;
    const key = resourceKey(node);
    return key ? removedPolicy.byResourceKey[key] ?? removedPolicy.defaultPolicy : removedPolicy.defaultPolicy;
  };
  const retainedRemoved = removedNodes.flatMap((node) => {
    const policy = policyFor(node);
    if (policy === 'remove') return [];
    return [policy === 'detach'
      ? {
          ...node,
          sourceTemplateId: undefined,
          sourceLogicalId: undefined,
          sourceResourceType: undefined,
          stackId: undefined,
          stackSetId: undefined,
          stackInstanceId: undefined,
          importStatus: 'manual',
        } as unknown as DiagramNode
      : { ...node, importStatus: 'removed' } as DiagramNode];
  });
  const policyIdentity = typeof removedPolicy === 'string' ? removedPolicy : JSON.stringify(removedPolicy);
  return {
    ...plan,
    id: stableId('reimport-plan', plan.id, policyIdentity),
    nodes: [...reconciledNodes, ...retainedRemoved],
    reconciliation: changeSet,
  };
}

/**
 * @file Physical containment policy rules.
 * @module domain/containment
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file validates parent-child placement between boundaries, resources, controls, and external references.
 */
import type { BoundaryNode, BoundaryType, DiagramDocument, DiagramNode } from './types';

/** Machine-readable reasons returned by containment policy decisions. */
export type ContainmentReasonCode =
  | 'VALID_ROOT'
  | 'VALID_CONTAINMENT'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NOT_BOUNDARY'
  | 'INVALID_TYPE_PAIR'
  | 'CYCLE'
  | 'SELF_PARENT'
  | 'REGION_MISMATCH'
  | 'AZ_MISMATCH';

/** Result of evaluating whether a node can be placed under a parent. */
export interface ContainmentDecision {
  readonly valid: boolean;
  readonly reasonCode: ContainmentReasonCode;
  readonly message: string;
  readonly suggestedParentIds: readonly string[];
}

/** Allowed physical parent types for each boundary type. */
const VALID_BOUNDARY_PARENTS: Readonly<Record<BoundaryType, readonly (BoundaryType | 'root')[]>> = {
  organization: ['root'],
  'organizational-unit': ['organization', 'organizational-unit'],
  account: ['organization', 'organizational-unit'],
  region: ['account'],
  vpc: ['region'],
  'availability-zone': ['region', 'vpc'],
  subnet: ['availability-zone'],
};

/** Allowed physical boundary parents for normalized AWS resource types. */
const RESOURCE_ALLOWED_PARENTS: Readonly<Record<string, readonly BoundaryType[]>> = {
  ec2: ['subnet'], alb: ['subnet','vpc'], nlb: ['subnet','vpc'], ecs: ['subnet','vpc'], eks: ['subnet','vpc'], lambda: ['subnet','vpc','region'],
  'api-gateway': ['region'], rds: ['subnet','vpc'], dynamodb: ['region'], s3: ['region'], sqs: ['region'], sns: ['region'], eventbridge: ['region'], kinesis: ['region'], elasticache: ['subnet','vpc'],
  'secrets-manager': ['region'], 'ssm-parameter': ['region'], cloudfront: ['account'], route53: ['account'], 'iam-role': ['account'], 'iam-policy': ['account'], 'security-group': ['vpc'], 'route-table': ['vpc'],
  'nat-gateway': ['subnet'], 'internet-gateway': ['vpc'], 'vpc-endpoint': ['subnet','vpc'], 'vpc-peering': ['region'], 'transit-gateway': ['region'], 'nested-stack': ['region'], 'lambda-layer': ['region'], 'step-functions': ['region'], appsync: ['region'], 'serverless-application': ['region'], 'serverless-connector': ['region'], 'cloudformation-generic': ['region','vpc','subnet'],
};

/** Collects all physical descendants of a node. */
function descendants(document: DiagramDocument, id: string): Set<string> {
  const result = new Set<string>();
  const visit = (current: string): void => {
    for (const node of Object.values(document.nodesById)) {
      if (node.physicalParentId === current && !result.has(node.id)) {
        result.add(node.id);
        visit(node.id);
      }
    }
  };
  visit(id);
  return result;
}

/** Finds valid boundary parents for a rejected containment move. */
function suggestedParents(document: DiagramDocument, node: DiagramNode): string[] {
  return Object.values(document.nodesById)
    .filter((candidate): candidate is BoundaryNode => candidate.kind === 'boundary')
    .filter((candidate) => isTypePairValid(node, candidate))
    .map((candidate) => candidate.id);
}

/** Checks whether a node kind can be contained by a boundary type. */
function isTypePairValid(node: DiagramNode, parent: BoundaryNode): boolean {
  if (node.kind === 'boundary') return VALID_BOUNDARY_PARENTS[node.boundaryType].includes(parent.boundaryType);
  if (node.kind === 'aws-resource') return (RESOURCE_ALLOWED_PARENTS[node.resourceType] ?? ['region']).includes(parent.boundaryType);
  if (node.kind === 'control') return ['account','region'].includes(parent.boundaryType);
  return ['account','region'].includes(parent.boundaryType);
}

/** Validates physical containment moves for diagram nodes. */
export class ContainmentPolicyService {
  decide(document: DiagramDocument, nodeId: string, parentId?: string): ContainmentDecision {
    const node = document.nodesById[nodeId];
    if (!node) return { valid: false, reasonCode: 'PARENT_NOT_FOUND', message: `Node ${nodeId} does not exist.`, suggestedParentIds: [] };
    if (!parentId) {
      const rootAllowed = node.kind === 'boundary' && VALID_BOUNDARY_PARENTS[node.boundaryType].includes('root');
      const detachedAllowed = node.kind !== 'boundary' || ['organization'].includes(node.boundaryType);
      return rootAllowed || detachedAllowed
        ? { valid: true, reasonCode: 'VALID_ROOT', message: 'Placement at the diagram root is valid.', suggestedParentIds: [] }
        : { valid: false, reasonCode: 'INVALID_TYPE_PAIR', message: `${node.name} requires a physical boundary parent.`, suggestedParentIds: suggestedParents(document, node) };
    }
    if (nodeId === parentId) return { valid: false, reasonCode: 'SELF_PARENT', message: 'A node cannot be its own parent.', suggestedParentIds: suggestedParents(document, node) };
    const parent = document.nodesById[parentId];
    if (!parent) return { valid: false, reasonCode: 'PARENT_NOT_FOUND', message: `Physical parent ${parentId} does not exist.`, suggestedParentIds: suggestedParents(document, node) };
    if (parent.kind !== 'boundary') return { valid: false, reasonCode: 'PARENT_NOT_BOUNDARY', message: 'Only physical boundary nodes may contain other nodes.', suggestedParentIds: suggestedParents(document, node) };
    if (descendants(document, nodeId).has(parentId)) return { valid: false, reasonCode: 'CYCLE', message: 'This placement would create a containment cycle.', suggestedParentIds: suggestedParents(document, node) };
    if (!isTypePairValid(node, parent)) return { valid: false, reasonCode: 'INVALID_TYPE_PAIR', message: `${node.kind === 'boundary' ? node.boundaryType : node.kind} cannot be physically contained by ${parent.boundaryType}.`, suggestedParentIds: suggestedParents(document, node) };
    if (node.kind === 'boundary' && node.boundaryType === 'subnet' && parent.boundaryType === 'availability-zone' && node.availabilityZoneName && parent.availabilityZoneName && node.availabilityZoneName !== parent.availabilityZoneName) {
      return { valid: false, reasonCode: 'AZ_MISMATCH', message: 'A subnet cannot be moved to a different Availability Zone without updating its semantic placement.', suggestedParentIds: suggestedParents(document, node) };
    }
    return { valid: true, reasonCode: 'VALID_CONTAINMENT', message: 'Physical containment is valid.', suggestedParentIds: [] };
  }
}

/** Shared containment policy instance used by store, layout, and inspector code. */
export const containmentPolicy = new ContainmentPolicyService();

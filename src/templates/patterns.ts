/** Built-in AWS architecture catalog and reusable local pattern cloning. */
import type { AwsResourceNode, AwsResourceType, DiagramDocument, DiagramEdge, DiagramNode, LogicalGroup } from '../domain/types';
import { createEmptyDocument } from '../domain/defaults';
import { getAbsolutePosition } from '../domain/coordinates';
import { uniqueId } from '../domain/ids';

export interface ReusablePattern {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly logicalGroups: readonly LogicalGroup[];
  readonly createdAt: string;
}

interface CatalogResource { readonly name: string; readonly resourceType: AwsResourceType; readonly cloudFormationType: string; readonly x: number; readonly y: number; }
interface CatalogDefinition { readonly id: string; readonly name: string; readonly description: string; readonly resources: readonly CatalogResource[]; readonly links: readonly Readonly<{ source: number; target: number; type: DiagramEdge['relationshipType'] }>[]; }

const definitions: readonly CatalogDefinition[] = [
  { id: 'multi-az-vpc', name: 'Multi-AZ VPC', description: 'Public/private networking with internet and NAT gateways.', resources: [
    { name: 'VPC', resourceType: 'cloudformation-generic', cloudFormationType: 'AWS::EC2::VPC', x: 0, y: 0 }, { name: 'Internet Gateway', resourceType: 'internet-gateway', cloudFormationType: 'AWS::EC2::InternetGateway', x: 240, y: 0 }, { name: 'Public Subnet A', resourceType: 'cloudformation-generic', cloudFormationType: 'AWS::EC2::Subnet', x: 0, y: 130 }, { name: 'Private Subnet A', resourceType: 'cloudformation-generic', cloudFormationType: 'AWS::EC2::Subnet', x: 240, y: 130 }, { name: 'Public Subnet B', resourceType: 'cloudformation-generic', cloudFormationType: 'AWS::EC2::Subnet', x: 0, y: 260 }, { name: 'Private Subnet B', resourceType: 'cloudformation-generic', cloudFormationType: 'AWS::EC2::Subnet', x: 240, y: 260 }, { name: 'NAT Gateway', resourceType: 'nat-gateway', cloudFormationType: 'AWS::EC2::NatGateway', x: 480, y: 130 },
  ], links: [{ source: 1, target: 0, type: 'associated-with' }, { source: 2, target: 0, type: 'associated-with' }, { source: 3, target: 6, type: 'routes-through' }, { source: 4, target: 0, type: 'associated-with' }, { source: 5, target: 6, type: 'routes-through' }] },
  { id: 'cloudfront-s3', name: 'CloudFront + S3', description: 'Edge distribution backed by an S3 origin.', resources: [{ name: 'Distribution', resourceType: 'cloudfront', cloudFormationType: 'AWS::CloudFront::Distribution', x: 0, y: 0 }, { name: 'Content Bucket', resourceType: 's3', cloudFormationType: 'AWS::S3::Bucket', x: 260, y: 0 }], links: [{ source: 0, target: 1, type: 'reads-from' }] },
  { id: 'alb-ecs', name: 'ALB + ECS Fargate', description: 'A load-balanced container service.', resources: [{ name: 'Application Load Balancer', resourceType: 'alb', cloudFormationType: 'AWS::ElasticLoadBalancingV2::LoadBalancer', x: 0, y: 0 }, { name: 'Fargate Service', resourceType: 'ecs', cloudFormationType: 'AWS::ECS::Service', x: 260, y: 0 }], links: [{ source: 0, target: 1, type: 'network-traffic' }] },
  { id: 'api-lambda-dynamodb', name: 'API + Lambda + DynamoDB', description: 'Serverless request processing and storage.', resources: [{ name: 'HTTP API', resourceType: 'api-gateway', cloudFormationType: 'AWS::ApiGatewayV2::Api', x: 0, y: 0 }, { name: 'Function', resourceType: 'lambda', cloudFormationType: 'AWS::Lambda::Function', x: 240, y: 0 }, { name: 'Table', resourceType: 'dynamodb', cloudFormationType: 'AWS::DynamoDB::Table', x: 480, y: 0 }], links: [{ source: 0, target: 1, type: 'network-traffic' }, { source: 1, target: 2, type: 'writes-to' }] },
  { id: 'event-worker-dlq', name: 'Event worker with DLQ', description: 'EventBridge to SQS and Lambda with a dead-letter queue.', resources: [{ name: 'Event Bus', resourceType: 'eventbridge', cloudFormationType: 'AWS::Events::EventBus', x: 0, y: 0 }, { name: 'Work Queue', resourceType: 'sqs', cloudFormationType: 'AWS::SQS::Queue', x: 240, y: 0 }, { name: 'Worker', resourceType: 'lambda', cloudFormationType: 'AWS::Lambda::Function', x: 480, y: 0 }, { name: 'Dead Letter Queue', resourceType: 'sqs', cloudFormationType: 'AWS::SQS::Queue', x: 240, y: 140 }], links: [{ source: 0, target: 1, type: 'publishes-event' }, { source: 1, target: 2, type: 'subscribes-to-event' }, { source: 1, target: 3, type: 'associated-with' }] },
  { id: 'sns-fanout', name: 'SNS fan-out', description: 'One topic distributing messages to independent queues.', resources: [{ name: 'Topic', resourceType: 'sns', cloudFormationType: 'AWS::SNS::Topic', x: 0, y: 80 }, { name: 'Orders Queue', resourceType: 'sqs', cloudFormationType: 'AWS::SQS::Queue', x: 260, y: 0 }, { name: 'Analytics Queue', resourceType: 'sqs', cloudFormationType: 'AWS::SQS::Queue', x: 260, y: 160 }], links: [{ source: 0, target: 1, type: 'publishes-event' }, { source: 0, target: 2, type: 'publishes-event' }] },
];

function slug(value: string): string { const clean = value.replace(/[^A-Za-z0-9]/g, ''); return /^[A-Za-z]/.test(clean) ? clean : `Resource${clean}`; }
function baseNode(resource: CatalogResource, index: number): AwsResourceNode {
  return { id: `catalog-${index}`, name: resource.name, kind: 'aws-resource', resourceType: resource.resourceType, cloudFormationType: resource.cloudFormationType, properties: {}, position: { x: resource.x, y: resource.y }, size: { width: 184, height: 78 }, sourceLogicalId: slug(resource.name), logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 10 + index, userMetadata: {}, diagramTags: {}, annotations: [], importStatus: 'manual' };
}

export const BUILT_IN_PATTERNS: readonly ReusablePattern[] = definitions.map((definition) => {
  const nodes = definition.resources.map(baseNode);
  return { schemaVersion: 1, id: definition.id, name: definition.name, description: definition.description, nodes, edges: definition.links.map((link, index) => ({ id: `catalog-edge-${index}`, source: nodes[link.source]!.id, target: nodes[link.target]!.id, relationshipType: link.type, direction: 'forward', metadata: {}, validationStatus: 'valid' })), logicalGroups: [], createdAt: '2026-10-15T00:00:00.000Z' };
});

const starterPatterns = ['multi-az-vpc', 'api-lambda-dynamodb', 'event-worker-dlq', 'alb-ecs'] as const;
export const BUILT_IN_STARTERS = [
  { id: 'highly-available-web', name: 'Highly available web application', description: 'Multi-AZ network foundation for a highly available web workload.', patternId: starterPatterns[0] },
  { id: 'serverless-rest-api', name: 'Serverless REST API', description: 'API Gateway, Lambda, and DynamoDB.', patternId: starterPatterns[1] },
  { id: 'event-driven-processing', name: 'Event-driven processing', description: 'Durable asynchronous event processing with a DLQ.', patternId: starterPatterns[2] },
  { id: 'containerized-web-service', name: 'Containerized web service', description: 'Application Load Balancer and ECS/Fargate.', patternId: starterPatterns[3] },
] as const;

function descendants(document: DiagramDocument, selected: Set<string>): Set<string> {
  let changed = true;
  while (changed) { changed = false; for (const node of Object.values(document.nodesById)) if (node.physicalParentId && selected.has(node.physicalParentId) && !selected.has(node.id)) { selected.add(node.id); changed = true; } }
  return selected;
}

/** Captures selected nodes, selected boundary descendants, and internal relationships. */
export function createPatternFromSelection(document: DiagramDocument, ids: readonly string[], name: string): ReusablePattern | undefined {
  const selected = descendants(document, new Set(ids)); if (selected.size === 0) return undefined;
  const nodes = document.nodeOrder.filter((id) => selected.has(id)).map((id) => document.nodesById[id]).filter((node): node is DiagramNode => Boolean(node));
  const edges = document.edgeOrder.map((id) => document.edgesById[id]).filter((edge): edge is DiagramEdge => Boolean(edge && selected.has(edge.source) && selected.has(edge.target)));
  const groupIds = new Set(nodes.flatMap((node) => node.logicalGroupIds));
  const logicalGroups = document.logicalGroupOrder.filter((id) => groupIds.has(id)).map((id) => document.logicalGroupsById[id]).filter((group): group is LogicalGroup => group !== undefined).map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => selected.has(id)) }));
  return { schemaVersion: 1, id: uniqueId('pattern'), name: name.trim() || 'Reusable pattern', description: `Saved from ${nodes.length} diagram elements.`, nodes, edges, logicalGroups, createdAt: new Date().toISOString() };
}

function rewrite(value: unknown, logicalIds: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((entry) => rewrite(entry, logicalIds));
  if (typeof value !== 'object' || value === null) return typeof value === 'string' && logicalIds.has(value) ? logicalIds.get(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry, logicalIds)]));
}

/** Inserts a reusable fragment with collision-safe entity and logical IDs. */
export function insertPattern(document: DiagramDocument, pattern: ReusablePattern, origin: { x: number; y: number }, targetStackId?: string): { document: DiagramDocument; nodeIds: string[] } {
  const ids = new Map(pattern.nodes.map((node) => [node.id, uniqueId('node')]));
  const logicalGroupIds = new Map((pattern.logicalGroups ?? []).map((group) => [group.id, uniqueId('logical-group')]));
  const existingLogical = new Set(Object.values(document.nodesById).map((node) => node.sourceLogicalId).filter(Boolean));
  const logicalIds = new Map<string, string>();
  for (const node of pattern.nodes) if (node.sourceLogicalId) { let next = node.sourceLogicalId; let suffix = 2; while (existingLogical.has(next)) next = `${node.sourceLogicalId}${suffix++}`; existingLogical.add(next); logicalIds.set(node.sourceLogicalId, next); }
  const minX = Math.min(...pattern.nodes.map((node) => getAbsolutePosition({ ...document, nodesById: Object.fromEntries(pattern.nodes.map((item) => [item.id, item])) } as DiagramDocument, node.id).x));
  const minY = Math.min(...pattern.nodes.map((node) => getAbsolutePosition({ ...document, nodesById: Object.fromEntries(pattern.nodes.map((item) => [item.id, item])) } as DiagramDocument, node.id).y));
  let stackId = targetStackId;
  const deploymentGroupsById = { ...document.deploymentGroupsById }; const deploymentGroupOrder = [...document.deploymentGroupOrder];
  const hasCloudFormationResources = pattern.nodes.some((node) => node.kind === 'aws-resource' || node.kind === 'boundary' && node.cloudFormation);
  if (!stackId && hasCloudFormationResources) { stackId = uniqueId('stack'); deploymentGroupsById[stackId] = { id: stackId, name: pattern.name, kind: 'stack', nodeIds: [], parameters: {}, outputs: {}, tags: {}, deploymentMetadata: [], metadata: {} }; deploymentGroupOrder.push(stackId); }
  const nodes = pattern.nodes.map((node) => {
    const absolute = getAbsolutePosition({ ...document, nodesById: Object.fromEntries(pattern.nodes.map((item) => [item.id, item])) } as DiagramDocument, node.id);
    const { sourceTemplateId: _st, sourceResourceType: _sr, sourcePropertyPath: _sp, sourceProjection: _projection, cdkConstructPath: _cdk, cdkHelper: _helper, stackSetId: _ss, stackInstanceId: _si, ...clean } = node; void _st; void _sr; void _sp; void _projection; void _cdk; void _helper; void _ss; void _si;
    const cloudFormationBacked = node.kind === 'aws-resource' || node.kind === 'boundary' && Boolean(node.cloudFormation);
    const clone = { ...clean, id: ids.get(node.id)!, position: { x: origin.x + absolute.x - minX, y: origin.y + absolute.y - minY }, physicalParentId: node.physicalParentId ? ids.get(node.physicalParentId) : undefined, stackId: cloudFormationBacked ? stackId : undefined, sourceLogicalId: cloudFormationBacked && node.sourceLogicalId ? logicalIds.get(node.sourceLogicalId) : undefined, logicalGroupIds: node.logicalGroupIds.map((id) => logicalGroupIds.get(id)).filter((id): id is string => Boolean(id)), attachedControlIds: node.attachedControlIds.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)), securityGroupIds: node.securityGroupIds.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)), importStatus: 'manual' } as DiagramNode;
    return clone.kind === 'aws-resource' ? { ...clone, properties: rewrite(clone.properties, logicalIds) as Record<string, unknown> } : clone;
  });
  const edges = pattern.edges.map((edge) => ({ ...edge, id: uniqueId('edge'), source: ids.get(edge.source)!, target: ids.get(edge.target)!, sourceTemplateId: undefined, importProvenance: undefined }));
  const nodeIds = nodes.map((node) => node.id); const resourceNodeIds = nodes.filter((node) => node.kind === 'aws-resource' || node.kind === 'boundary' && node.cloudFormation).map((node) => node.id); const group = stackId ? deploymentGroupsById[stackId] : undefined; if (group && stackId) deploymentGroupsById[stackId] = { ...group, nodeIds: [...new Set([...group.nodeIds, ...resourceNodeIds])] };
  const logicalGroups = (pattern.logicalGroups ?? []).map((group) => ({ ...group, id: logicalGroupIds.get(group.id)!, nodeIds: group.nodeIds.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)) }));
  return { document: { ...document, nodesById: { ...document.nodesById, ...Object.fromEntries(nodes.map((node) => [node.id, node])) }, nodeOrder: [...document.nodeOrder, ...nodeIds], edgesById: { ...document.edgesById, ...Object.fromEntries(edges.map((edge) => [edge.id, edge])) }, edgeOrder: [...document.edgeOrder, ...edges.map((edge) => edge.id)], deploymentGroupsById, deploymentGroupOrder, logicalGroupsById: { ...document.logicalGroupsById, ...Object.fromEntries(logicalGroups.map((group) => [group.id, group])) }, logicalGroupOrder: [...document.logicalGroupOrder, ...logicalGroups.map((group) => group.id)] }, nodeIds };
}

export function createStarter(starterId: string): DiagramDocument | undefined {
  const starter = BUILT_IN_STARTERS.find((entry) => entry.id === starterId); if (!starter) return undefined;
  const pattern = BUILT_IN_PATTERNS.find((entry) => entry.id === starter.patternId)!;
  return { ...insertPattern(createEmptyDocument(starter.name), pattern, { x: 80, y: 80 }).document, metadata: { ...createEmptyDocument(starter.name).metadata, title: starter.name, description: starter.description } };
}

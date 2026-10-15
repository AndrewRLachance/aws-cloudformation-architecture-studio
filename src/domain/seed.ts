/**
 * @file Bundled demonstration architecture seed.
 * @module domain/seed
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file creates the sample multi-account AWS architecture used when the editor starts.
 */
import type { AwsResourceNode, BoundaryNode, DiagramDocument, DiagramEdge, DiagramNode, StackDeploymentGroup, StackSetDeploymentGroup } from './types';
import { createEmptyDocument } from './defaults';
import { stableId } from './ids';

/** Stable identifiers used by the bundled demonstration architecture. */
const ids = {
  org: 'org-acme', ou: 'ou-production', sharedAccount: 'account-shared', prodAccount: 'account-prod', sharedRegion: 'region-shared-use1', prodRegion: 'region-prod-use1', vpc: 'vpc-prod', azA: 'az-prod-a', azB: 'az-prod-b',
  publicA: 'subnet-public-a', publicB: 'subnet-public-b', appA: 'subnet-app-a', appB: 'subnet-app-b', dataA: 'subnet-data-a', dataB: 'subnet-data-b',
  networkStack: 'stack-network', appStack: 'stack-app', stackSet: 'stackset-baseline', sharedLogical: 'logical-shared-platform', appLogical: 'logical-application',
};

/** Creates shared node fields for the seed document. */
function base(id: string, name: string, x: number, y: number, width: number, height: number) {
  return { id, name, position: { x, y }, size: { width, height }, logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 1, userMetadata: {}, diagramTags: {}, annotations: [] } as const;
}
/** Creates a boundary node for the seed document. */
function boundary(id: string, name: string, type: BoundaryNode['boundaryType'], x: number, y: number, width: number, height: number, extras: Partial<BoundaryNode> = {}): BoundaryNode {
  return { ...base(id, name, x, y, width, height), kind: 'boundary', boundaryType: type, ...extras };
}
/** Creates an AWS resource node for the seed document. */
function resource(id: string, name: string, resourceType: AwsResourceNode['resourceType'], cloudFormationType: string, x: number, y: number, extras: Partial<AwsResourceNode> = {}): AwsResourceNode {
  return { ...base(id, name, x, y, 180, 76), kind: 'aws-resource', resourceType, cloudFormationType, properties: {}, zIndex: 10, ...extras };
}
/** Creates a semantic edge for the seed document. */
function edge(source: string, target: string, type: DiagramEdge['relationshipType'], label: string): DiagramEdge {
  return { id: stableId('edge', source, target, type), source, target, relationshipType: type, label, direction: 'forward', metadata: {}, validationStatus: 'valid' };
}

/** Creates the bundled multi-account demonstration architecture document. */
export function createSeedDocument(): DiagramDocument {
  const document = createEmptyDocument('Production multi-account architecture');
  const nodes: DiagramNode[] = [
    boundary(ids.org, 'Acme AWS Organization', 'organization', 24, 24, 2100, 1540),
    boundary(ids.ou, 'Production OU', 'organizational-unit', 32, 72, 2020, 1420, { physicalParentId: ids.org }),
    boundary(ids.sharedAccount, 'Shared Services · 111111111111', 'account', 28, 74, 760, 1300, { physicalParentId: ids.ou, accountId: '111111111111' }),
    boundary(ids.prodAccount, 'Production · 222222222222', 'account', 810, 74, 1170, 1300, { physicalParentId: ids.ou, accountId: '222222222222' }),
    // Account-scoped resources use the strip above the Region instead of occupying
    // the same canvas area as Region descendants.
    boundary(ids.sharedRegion, 'us-east-1', 'region', 28, 190, 690, 1070, { physicalParentId: ids.sharedAccount, accountId: '111111111111', regionName: 'us-east-1' }),
    boundary(ids.prodRegion, 'us-east-1', 'region', 28, 190, 1100, 1070, { physicalParentId: ids.prodAccount, accountId: '222222222222', regionName: 'us-east-1' }),
    boundary(ids.vpc, 'Production VPC · 10.20.0.0/16', 'vpc', 36, 100, 1040, 820, { physicalParentId: ids.prodRegion, cidr: '10.20.0.0/16', stackId: ids.networkStack }),
    boundary(ids.azA, 'us-east-1a', 'availability-zone', 28, 78, 470, 600, { physicalParentId: ids.vpc, availabilityZoneName: 'us-east-1a' }),
    boundary(ids.azB, 'us-east-1b', 'availability-zone', 520, 78, 470, 600, { physicalParentId: ids.vpc, availabilityZoneName: 'us-east-1b' }),
    // Each subnet reserves 48px for its title before placing its resource card.
    boundary(ids.publicA, 'Public A · 10.20.0.0/24', 'subnet', 24, 64, 420, 160, { physicalParentId: ids.azA, availabilityZoneName: 'us-east-1a', cidr: '10.20.0.0/24', stackId: ids.networkStack }),
    boundary(ids.appA, 'Private App A · 10.20.10.0/24', 'subnet', 24, 234, 420, 160, { physicalParentId: ids.azA, availabilityZoneName: 'us-east-1a', cidr: '10.20.10.0/24', stackId: ids.networkStack }),
    boundary(ids.dataA, 'Isolated Data A · 10.20.20.0/24', 'subnet', 24, 404, 420, 160, { physicalParentId: ids.azA, availabilityZoneName: 'us-east-1a', cidr: '10.20.20.0/24', stackId: ids.networkStack }),
    boundary(ids.publicB, 'Public B · 10.20.1.0/24', 'subnet', 24, 64, 420, 160, { physicalParentId: ids.azB, availabilityZoneName: 'us-east-1b', cidr: '10.20.1.0/24', stackId: ids.networkStack }),
    boundary(ids.appB, 'Private App B · 10.20.11.0/24', 'subnet', 24, 234, 420, 160, { physicalParentId: ids.azB, availabilityZoneName: 'us-east-1b', cidr: '10.20.11.0/24', stackId: ids.networkStack }),
    boundary(ids.dataB, 'Isolated Data B · 10.20.21.0/24', 'subnet', 24, 404, 420, 160, { physicalParentId: ids.azB, availabilityZoneName: 'us-east-1b', cidr: '10.20.21.0/24', stackId: ids.networkStack }),
    resource('alb-prod', 'Application Load Balancer', 'alb', 'AWS::ElasticLoadBalancingV2::LoadBalancer', 70, 56, { physicalParentId: ids.publicA, stackId: ids.appStack, logicalGroupIds: [ids.appLogical], securityGroupIds: ['sg-edge'] }),
    resource('ecs-service-a', 'ECS Service · task set A', 'ecs', 'AWS::ECS::Service', 50, 56, { physicalParentId: ids.appA, stackId: ids.appStack, logicalGroupIds: [ids.appLogical], securityGroupIds: ['sg-app'] }),
    resource('ecs-service-b', 'ECS Service · task set B', 'ecs', 'AWS::ECS::Service', 50, 56, { physicalParentId: ids.appB, stackId: ids.appStack, logicalGroupIds: [ids.appLogical], securityGroupIds: ['sg-app'] }),
    resource('rds-primary', 'Aurora PostgreSQL', 'rds', 'AWS::RDS::DBCluster', 72, 56, { physicalParentId: ids.dataA, stackId: ids.appStack, logicalGroupIds: [ids.appLogical], securityGroupIds: ['sg-data'] }),
    resource('rds-secondary', 'Aurora secondary AZ', 'rds', 'AWS::RDS::DBInstance', 72, 56, { physicalParentId: ids.dataB, stackId: ids.appStack, logicalGroupIds: [ids.appLogical], securityGroupIds: ['sg-data'] }),
    resource('iam-execution-role', 'Application execution role', 'iam-role', 'AWS::IAM::Role', 80, 82, { physicalParentId: ids.prodAccount, stackId: ids.appStack, logicalGroupIds: [ids.appLogical] }),
    // Region-scoped resources live below the VPC; VPC-scoped security groups live
    // below the Availability Zones. These lanes prevent unrelated scopes crossing.
    resource('s3-assets', 'Application assets', 's3', 'AWS::S3::Bucket', 90, 960, { physicalParentId: ids.prodRegion, stackId: ids.appStack, logicalGroupIds: [ids.appLogical] }),
    resource('ddb-sessions', 'Session table', 'dynamodb', 'AWS::DynamoDB::Table', 300, 960, { physicalParentId: ids.prodRegion, stackId: ids.appStack, logicalGroupIds: [ids.appLogical] }),
    resource('sg-edge', 'Edge security group', 'security-group', 'AWS::EC2::SecurityGroup', 400, 720, { physicalParentId: ids.vpc, stackId: ids.networkStack, logicalGroupIds: [ids.sharedLogical] }),
    resource('sg-app', 'Application security group', 'security-group', 'AWS::EC2::SecurityGroup', 610, 720, { physicalParentId: ids.vpc, stackId: ids.networkStack, logicalGroupIds: [ids.sharedLogical] }),
    resource('sg-data', 'Data security group', 'security-group', 'AWS::EC2::SecurityGroup', 820, 720, { physicalParentId: ids.vpc, stackId: ids.networkStack, logicalGroupIds: [ids.sharedLogical] }),
    resource('shared-transit-gateway', 'Transit Gateway', 'transit-gateway', 'AWS::EC2::TransitGateway', 80, 180, { physicalParentId: ids.sharedRegion, stackId: ids.networkStack, logicalGroupIds: [ids.sharedLogical] }),
    resource('cross-account-role', 'Production network access role', 'iam-role', 'AWS::IAM::Role', 80, 82, { physicalParentId: ids.sharedAccount, stackId: ids.networkStack, logicalGroupIds: [ids.sharedLogical] }),
  ];
  const edges: DiagramEdge[] = [
    edge('alb-prod', 'ecs-service-a', 'network-traffic', 'HTTPS 443 → 8080'), edge('alb-prod', 'ecs-service-b', 'network-traffic', 'HTTPS 443 → 8080'),
    edge('ecs-service-a', 'rds-primary', 'reads-from', 'PostgreSQL 5432'), edge('ecs-service-b', 'rds-secondary', 'reads-from', 'PostgreSQL 5432'),
    edge('ecs-service-a', 's3-assets', 'reads-from', 'S3 API'), edge('ecs-service-a', 'ddb-sessions', 'writes-to', 'DynamoDB API'),
    edge('ecs-service-a', 'iam-execution-role', 'assumes-role', 'task role'), edge('iam-execution-role', 'cross-account-role', 'assumes-role', 'cross-account'),
    edge('sg-edge', 'sg-app', 'permits-access', 'TCP 8080'), edge('sg-app', 'sg-data', 'permits-access', 'TCP 5432'),
    edge('shared-transit-gateway', ids.vpc, 'routes-through', 'shared network'), edge('s3-assets', 'ddb-sessions', 'imports-cloudformation-output', 'SharedDataPrefix'),
  ];
  const networkGroup: StackDeploymentGroup = { id: ids.networkStack, name: 'shared-network', kind: 'stack', nodeIds: nodes.filter((node) => node.stackId === ids.networkStack).map((node) => node.id), accountId: '111111111111', region: 'us-east-1', parameters: {}, outputs: { VpcId: { Value: { Ref: 'ProductionVpc' }, Export: { Name: 'SharedVpcId' } } }, tags: { Environment: 'production' }, deploymentMetadata: [], metadata: {} };
  const appGroup: StackDeploymentGroup = { id: ids.appStack, name: 'application', kind: 'stack', nodeIds: nodes.filter((node) => node.stackId === ids.appStack).map((node) => node.id), accountId: '222222222222', region: 'us-east-1', parameters: { VpcId: { 'Fn::ImportValue': 'SharedVpcId' } }, outputs: {}, tags: { Environment: 'production' }, deploymentMetadata: [], metadata: {} };
  const stackSet: StackSetDeploymentGroup = {
    id: ids.stackSet,
    name: 'security-baseline',
    kind: 'stackset',
    nodeIds: [],
    unresolvedTargets: false,
    permissionModel: 'SERVICE_MANAGED',
    targetGroups: [{ id: 'stackset-target-security', accounts: [], organizationalUnitIds: ['ou-prod-12345678'], regions: ['us-east-1', 'us-west-2'], parameterOverrides: {} }],
    operationPreferences: { concurrencyMode: 'STRICT_FAILURE_TOLERANCE', failureToleranceCount: 0, maxConcurrentCount: 1, regionConcurrencyType: 'SEQUENTIAL', regionOrder: ['us-east-1', 'us-west-2'] },
    metadata: {},
  };
  const now = new Date().toISOString();
  return {
    ...document,
    metadata: { ...document.metadata, description: 'Seed demonstrating physical containment independent from stack, IAM, logical, security, and StackSet relationships.', updatedAt: now },
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])), nodeOrder: nodes.map((node) => node.id),
    edgesById: Object.fromEntries(edges.map((item) => [item.id, item])), edgeOrder: edges.map((item) => item.id),
    deploymentGroupsById: { [networkGroup.id]: networkGroup, [appGroup.id]: appGroup, [stackSet.id]: stackSet }, deploymentGroupOrder: [networkGroup.id, appGroup.id, stackSet.id],
    logicalGroupsById: {
      [ids.sharedLogical]: { id: ids.sharedLogical, name: 'Shared Platform', nodeIds: nodes.filter((node) => node.logicalGroupIds.includes(ids.sharedLogical)).map((node) => node.id), colorToken: 'teal' },
      [ids.appLogical]: { id: ids.appLogical, name: 'Customer Application', nodeIds: nodes.filter((node) => node.logicalGroupIds.includes(ids.appLogical)).map((node) => node.id), colorToken: 'blue' },
    }, logicalGroupOrder: [ids.sharedLogical, ids.appLogical],
    stackInstancesById: {
      'stack-instance-shared': { id: 'stack-instance-shared', stackSetId: ids.stackSet, accountId: '111111111111', region: 'us-east-1', status: 'CURRENT', driftStatus: 'IN_SYNC', parameterOverrides: {} },
      'stack-instance-prod': { id: 'stack-instance-prod', stackSetId: ids.stackSet, accountId: '222222222222', region: 'us-east-1', status: 'CURRENT', driftStatus: 'IN_SYNC', parameterOverrides: {} },
    }, stackInstanceOrder: ['stack-instance-shared', 'stack-instance-prod'],
    revision: { number: 1, lastCommand: 'load-seed', updatedAt: now },
  };
}

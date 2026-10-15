/**
 * @file Local CloudFormation import planning.
 * @module cloudformation/importer
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file expands uploaded sources, detects metadata, builds diagram entities, and prepares previewable import plans.
 */
import { z } from 'zod';
import type {
  AwsResourceNode,
  BoundaryNode,
  CloudFormationImportDiagnostic,
  CloudFormationImportPlan,
  CloudFormationImportSource,
  CloudFormationTemplateRecord,
  DeploymentGroup,
  DiagramEdge,
  DiagramNode,
  ExternalReferenceNode,
  IntrinsicReference,
  NestedStackDeploymentGroup,
  PlacementResolution,
  StackDeploymentGroup,
  StackInstance,
  StackSetDeploymentGroup,
  StackSetTargetGroup,
  CloudFormationImportAnalysis,
  ImportAssociationCandidate,
  ImportAssociationResolution,
  NestedAssociationCandidate,
  NestedAssociationResolution,
  CloudAssemblyMetadata,
  DeploymentMetadataArtifact,
  JsonValue,
} from '../domain/types';
import { sha256Text, stableId, uniqueId } from '../domain/ids';
import { parseCloudFormationTemplate, type SourceFile } from './parser';
import { analyzeIntrinsicReferences, referencesToEdges } from './dependency';
import { evaluateStaticExpression, expressionFingerprint } from './fidelity';

/** Browser-provided CloudFormation file or ZIP payload prepared for ingestion. */
export interface ImportFile {
  readonly name: string;
  readonly data: string | ArrayBuffer;
}

/** User-selected import settings and optional metadata defaults. */
export interface ImportOptions {
  readonly importType: CloudFormationImportSource['importType'];
  readonly defaultAccountId?: string;
  readonly defaultRegion?: string;
  readonly stackNameOverrides?: Readonly<Record<string, string>>;
}

/** Progress callback used by the import wizard and diagnostics panel. */
export type ImportProgressCallback = (phase: string, completed: number, total: number, message: string) => void;

/** Zod schema for optional multi-template import manifests. */
const importManifestTemplateSchema = z.object({
    filename: z.string(),
    stackId: z.string().optional(),
    stackName: z.string().optional(),
    accountId: z.string().optional(),
    region: z.string().optional(),
    parentStackId: z.string().optional(),
    stackSetId: z.string().optional(),
    exports: z.array(z.string()).optional(),
    importConsumers: z.array(z.string()).optional(),
    metadataFiles: z.array(z.object({ filename: z.string(), kind: z.enum(['stack-policy','change-set','termination-protection','stack-drift','resource-drifts']) })).optional(),
});
export const importManifestSchema = z.union([z.object({
  schemaVersion: z.literal(1),
  templates: z.array(importManifestTemplateSchema.omit({ metadataFiles: true })),
}), z.object({
  schemaVersion: z.literal(2),
  templates: z.array(importManifestTemplateSchema),
})]);
/** Validated manifest that annotates imported templates with deployment metadata. */
export type ImportManifest = z.infer<typeof importManifestSchema>;

/** Detected stack metadata from AWS CLI describe/list outputs. */
interface StackMetadata {
  readonly stackId?: string;
  readonly stackName?: string;
  readonly accountId?: string;
  readonly region?: string;
  readonly status?: string;
  readonly parameters: Record<string, unknown>;
  readonly outputs: Record<string, unknown>;
  readonly tags: Record<string, string>;
  readonly physicalIds: Record<string, string>;
  readonly parentId?: string;
  readonly rootId?: string;
  readonly sourceFilename?: string;
  readonly terminationProtection?: boolean;
  readonly driftInformation?: unknown;
}

/** Detected StackSet metadata from AWS CLI describe-stack-set output. */
interface StackSetMetadata {
  readonly id?: string;
  readonly name?: string;
  readonly permissionModel?: string;
  readonly templateBody?: string | Record<string, unknown>;
}

/** Checks whether an unknown value is a non-array object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Returns a non-empty string value when the input is string-like metadata. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
/** Converts AWS CLI key/value arrays into plain records. */
function valuesToRecord(items: unknown, keyName: string, valueName: string): Record<string, unknown> {
  if (!Array.isArray(items)) return {};
  return Object.fromEntries(items.flatMap((entry) => isRecord(entry) && typeof entry[keyName] === 'string' ? [[entry[keyName], entry[valueName]]] : []));
}
/** Converts AWS tag arrays into a tag record. */
function tagsToRecord(items: unknown): Record<string, string> {
  if (!Array.isArray(items)) return {};
  return Object.fromEntries(items.flatMap((entry) => isRecord(entry) && typeof entry.Key === 'string' && typeof entry.Value === 'string' ? [[entry.Key, entry.Value]] : []));
}
/** Extracts account and Region components from an AWS ARN. */
function accountRegionFromArn(arn?: string): { accountId?: string; region?: string } {
  if (!arn?.startsWith('arn:')) return {};
  const parts = arn.split(':');
  return { ...(parts[4] ? { accountId: parts[4] } : {}), ...(parts[3] ? { region: parts[3] } : {}) };
}

/** Expands user-selected files and ZIP archives into parseable source files. */
async function expandInputFiles(files: readonly ImportFile[]): Promise<SourceFile[]> {
  const expanded: SourceFile[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file.data);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.(json|ya?ml)$/i.test(entry.name));
      for (const entry of entries) expanded.push({ name: entry.name, text: await entry.async('string') });
    } else {
      expanded.push({ name: file.name, text: typeof file.data === 'string' ? file.data : new TextDecoder().decode(file.data) });
    }
  }
  return expanded.sort((a, b) => a.name.localeCompare(b.name));
}

/** Parses JSON source text when possible without surfacing parse errors. */
function parseJson(file: SourceFile): unknown | undefined {
  try { return JSON.parse(file.text) as unknown; } catch { return undefined; }
}

/** Finds and validates an optional import manifest file. */
function detectManifest(files: readonly SourceFile[]): ImportManifest | undefined {
  for (const file of files) {
    if (!/manifest/i.test(file.name)) continue;
    const parsed = parseJson(file);
    const result = importManifestSchema.safeParse(parsed);
    if (result.success) return result.data;
  }
  return undefined;
}

/** Detects the safe stack-artifact subset of a CDK cloud assembly manifest. */
function detectCloudAssembly(files: readonly SourceFile[]): CloudAssemblyMetadata | undefined {
  const manifestFile = files.find((file) => /(?:^|\/)manifest\.json$/i.test(file.name) && !/import-manifest/i.test(file.name));
  const parsed = manifestFile ? parseJson(manifestFile) : undefined;
  if (!isRecord(parsed) || typeof parsed.version !== 'string' || !isRecord(parsed.artifacts)) return undefined;
  const artifacts = Object.entries(parsed.artifacts).flatMap(([id, raw]) => {
    if (!isRecord(raw) || typeof raw.type !== 'string') return [];
    const properties = isRecord(raw.properties) ? raw.properties : {};
    return [{ id, type: raw.type, ...(asString(properties.templateFile) ? { templateFile: asString(properties.templateFile) } : {}), ...(asString(raw.displayName) ? { displayName: asString(raw.displayName) } : {}), ...(asString(raw.environment) ? { environment: asString(raw.environment) } : {}), dependencies: Array.isArray(raw.dependencies) ? raw.dependencies.filter((entry): entry is string => typeof entry === 'string') : [] }];
  });
  const assetManifestFiles = Object.values(parsed.artifacts).flatMap((raw) => isRecord(raw) && typeof raw.type === 'string' && raw.type.includes('asset-manifest') && isRecord(raw.properties) && typeof raw.properties.file === 'string' ? [raw.properties.file] : []);
  return { manifestVersion: parsed.version, artifacts, assetManifestFiles };
}

/** Detects optional AWS CLI deployment metadata without interpreting or mutating it. */
function detectDeploymentMetadata(files: readonly SourceFile[]): DeploymentMetadataArtifact[] {
  const artifacts: DeploymentMetadataArtifact[] = [];
  for (const file of files) {
    const parsed = parseJson(file);
    if (!isRecord(parsed)) continue;
    const add = (kind: DeploymentMetadataArtifact['kind'], payload: unknown, stackId?: string, stackName?: string): void => { artifacts.push({ id: stableId('deployment-metadata', file.name, kind, stackId ?? stackName ?? ''), kind, originalFilename: file.name, payload: payload as JsonValue, ...(stackId ? { stackId } : {}), ...(stackName ? { stackName } : {}) }); };
    if ('StackPolicyBody' in parsed) add('stack-policy', parsed, asString(parsed.StackId), asString(parsed.StackName));
    if (typeof parsed.ChangeSetName === 'string' || Array.isArray(parsed.Changes)) add('change-set', parsed, asString(parsed.StackId), asString(parsed.StackName));
    if (Array.isArray(parsed.StackResourceDrifts)) {
      const first = parsed.StackResourceDrifts.find(isRecord);
      add('resource-drifts', parsed, isRecord(first) ? asString(first.StackId) : asString(parsed.StackId), asString(parsed.StackName));
    }
    if (Array.isArray(parsed.Stacks)) for (const stack of parsed.Stacks) if (isRecord(stack)) {
      if (typeof stack.EnableTerminationProtection === 'boolean') add('termination-protection', { EnableTerminationProtection: stack.EnableTerminationProtection }, asString(stack.StackId), asString(stack.StackName));
      if (stack.DriftInformation !== undefined) add('stack-drift', stack.DriftInformation, asString(stack.StackId), asString(stack.StackName));
    }
  }
  return artifacts;
}

/** Detects stack metadata from AWS CLI output files. */
function detectStackMetadata(files: readonly SourceFile[]): StackMetadata[] {
  const metadata: StackMetadata[] = [];
  for (const file of files) {
    const parsed = parseJson(file);
    if (!isRecord(parsed)) continue;
    if (Array.isArray(parsed.Stacks)) {
      for (const raw of parsed.Stacks) {
        if (!isRecord(raw)) continue;
        const stackId = asString(raw.StackId);
        const arn = accountRegionFromArn(stackId);
        metadata.push({
          ...(stackId ? { stackId } : {}),
          ...(asString(raw.StackName) ? { stackName: asString(raw.StackName) } : {}),
          ...(arn.accountId ? { accountId: arn.accountId } : {}),
          ...(arn.region ? { region: arn.region } : {}),
          ...(asString(raw.StackStatus) ? { status: asString(raw.StackStatus) } : {}),
          parameters: valuesToRecord(raw.Parameters, 'ParameterKey', 'ParameterValue'),
          outputs: valuesToRecord(raw.Outputs, 'OutputKey', 'OutputValue'),
          tags: tagsToRecord(raw.Tags),
          physicalIds: {},
          ...(asString(raw.ParentId) ? { parentId: asString(raw.ParentId) } : {}),
          ...(asString(raw.RootId) ? { rootId: asString(raw.RootId) } : {}),
          sourceFilename: file.name,
          ...(typeof raw.EnableTerminationProtection === 'boolean' ? { terminationProtection: raw.EnableTerminationProtection } : {}),
          ...(raw.DriftInformation !== undefined ? { driftInformation: raw.DriftInformation } : {}),
        });
      }
    }
    if (Array.isArray(parsed.StackResourceSummaries)) {
      const physicalIds = Object.fromEntries(parsed.StackResourceSummaries.flatMap((item) => isRecord(item) && typeof item.LogicalResourceId === 'string' && typeof item.PhysicalResourceId === 'string' ? [[item.LogicalResourceId, item.PhysicalResourceId]] : []));
      metadata.push({
        ...(asString(parsed.StackId) ? { stackId: asString(parsed.StackId) } : {}),
        parameters: {}, outputs: {}, tags: {}, physicalIds,
        sourceFilename: file.name,
      });
    }
  }
  return metadata;
}

/** Detects StackSet metadata from AWS CLI output files. */
function detectStackSetMetadata(files: readonly SourceFile[]): StackSetMetadata | undefined {
  for (const file of files) {
    const parsed = parseJson(file);
    if (!isRecord(parsed) || !isRecord(parsed.StackSet)) continue;
    const raw = parsed.StackSet;
    const result: StackSetMetadata = {};
    const id = asString(raw.StackSetId);
    const name = asString(raw.StackSetName);
    const permissionModel = asString(raw.PermissionModel);
    if (id) Object.assign(result, { id });
    if (name) Object.assign(result, { name });
    if (permissionModel) Object.assign(result, { permissionModel });
    if (typeof raw.TemplateBody === 'string' || isRecord(raw.TemplateBody)) Object.assign(result, { templateBody: raw.TemplateBody });
    return result;
  }
  return undefined;
}

/** Detects StackSet instances from AWS CLI summaries. */
function detectStackInstances(files: readonly SourceFile[], stackSetId: string): StackInstance[] {
  const unique = new Map<string, StackInstance>();
  for (const file of files) {
    const parsed = parseJson(file);
    if (!isRecord(parsed) || !Array.isArray(parsed.Summaries)) continue;
    for (const raw of parsed.Summaries) {
      if (!isRecord(raw)) continue;
      const accountId = asString(raw.Account);
      const region = asString(raw.Region);
      if (!accountId || !region) continue;
      const id = stableId('stack-instance', stackSetId, accountId, region);
      unique.set(`${accountId}|${region}`, {
        id,
        stackSetId,
        accountId,
        region,
        ...(asString(raw.StackId) ? { stackId: asString(raw.StackId) } : {}),
        ...(asString(raw.Status) ? { status: asString(raw.Status) } : {}),
        ...(asString(raw.DriftStatus) ? { driftStatus: asString(raw.DriftStatus) } : {}),
        parameterOverrides: valuesToRecord(raw.ParameterOverrides, 'ParameterKey', 'ParameterValue'),
        ...(asString(raw.LastOperationId) ? { lastOperationId: asString(raw.LastOperationId) } : {}),
      });
    }
  }
  return [...unique.values()].sort((a, b) => `${a.accountId}:${a.region}`.localeCompare(`${b.accountId}:${b.region}`));
}

/** Maps CloudFormation resource type names to normalized canvas resource categories. */
const RESOURCE_TYPE_MAP: Readonly<Record<string, AwsResourceNode['resourceType']>> = {
  'AWS::EC2::Instance': 'ec2', 'AWS::ElasticLoadBalancingV2::LoadBalancer': 'alb', 'AWS::ECS::Service': 'ecs', 'AWS::EKS::Cluster': 'eks', 'AWS::Lambda::Function': 'lambda',
  'AWS::ApiGateway::RestApi': 'api-gateway', 'AWS::ApiGatewayV2::Api': 'api-gateway', 'AWS::RDS::DBInstance': 'rds', 'AWS::RDS::DBCluster': 'rds', 'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::S3::Bucket': 's3', 'AWS::SQS::Queue': 'sqs', 'AWS::SNS::Topic': 'sns', 'AWS::Events::EventBus': 'eventbridge', 'AWS::Events::Rule': 'eventbridge', 'AWS::Kinesis::Stream': 'kinesis',
  'AWS::ElastiCache::CacheCluster': 'elasticache', 'AWS::ElastiCache::ReplicationGroup': 'elasticache', 'AWS::SecretsManager::Secret': 'secrets-manager', 'AWS::SSM::Parameter': 'ssm-parameter',
  'AWS::CloudFront::Distribution': 'cloudfront', 'AWS::Route53::HostedZone': 'route53', 'AWS::IAM::Role': 'iam-role', 'AWS::IAM::Policy': 'iam-policy', 'AWS::EC2::SecurityGroup': 'security-group',
  'AWS::EC2::RouteTable': 'route-table', 'AWS::EC2::NatGateway': 'nat-gateway', 'AWS::EC2::InternetGateway': 'internet-gateway', 'AWS::EC2::VPCEndpoint': 'vpc-endpoint',
  'AWS::EC2::VPCPeeringConnection': 'vpc-peering', 'AWS::EC2::TransitGateway': 'transit-gateway', 'AWS::CloudFormation::Stack': 'nested-stack',
  'AWS::Serverless::Function': 'lambda', 'AWS::Serverless::Api': 'api-gateway', 'AWS::Serverless::HttpApi': 'api-gateway', 'AWS::Serverless::SimpleTable': 'dynamodb',
  'AWS::Serverless::StateMachine': 'step-functions', 'AWS::Serverless::LayerVersion': 'lambda-layer', 'AWS::Serverless::Application': 'serverless-application', 'AWS::Serverless::Connector': 'serverless-connector', 'AWS::Serverless::GraphQLApi': 'appsync',
};

/** Returns a CloudFormation resource object when the raw value has a Type. */
function getResource(raw: unknown): Record<string, unknown> | undefined { return isRecord(raw) && typeof raw.Type === 'string' ? raw : undefined; }
/** Returns a Ref target from a CloudFormation intrinsic object. */
function ref(value: unknown): string | undefined { return isRecord(value) && typeof value.Ref === 'string' ? value.Ref : undefined; }

/** Creates shared defaults for imported boundary nodes. */
function boundaryBase(id: string, name: string, position: { x: number; y: number }, size: { width: number; height: number }): Omit<BoundaryNode, 'kind' | 'boundaryType'> {
  return { id, name, position, size, logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 0, userMetadata: {}, diagramTags: {}, annotations: [] };
}
/** Creates shared defaults for imported AWS resource nodes. */
function resourceBase(id: string, name: string, position: { x: number; y: number }): Omit<AwsResourceNode, 'kind' | 'resourceType' | 'cloudFormationType' | 'properties'> {
  return { id, name, position, size: { width: 184, height: 78 }, logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 10, userMetadata: {}, diagramTags: {}, annotations: [] };
}

/** Copies editable CloudFormation fields from a parsed resource. */
function editableResource(resource: Record<string, unknown>, properties: Record<string, unknown>) {
  return {
    type: resource.Type as string,
    properties,
    ...(typeof resource.Condition === 'string' ? { condition: resource.Condition } : {}),
    ...(isRecord(resource.Metadata) ? { metadata: resource.Metadata } : {}),
    ...(typeof resource.DeletionPolicy === 'string' ? { deletionPolicy: resource.DeletionPolicy } : {}),
    ...(typeof resource.UpdateReplacePolicy === 'string' ? { updateReplacePolicy: resource.UpdateReplacePolicy } : {}),
  };
}

/** Builds diagram nodes and physical placement suggestions for one template. */
function buildTemplateNodes(template: CloudFormationTemplateRecord, ownerId: string, ownerKind: 'stack' | 'stackset', accountId: string, region: string, templateIndex = 0): { nodes: DiagramNode[]; placements: PlacementResolution[]; nodeIdByLogicalId: Record<string, string> } {
  const nodes: DiagramNode[] = [];
  const placements: PlacementResolution[] = [];
  const accountNodeId = stableId('account', accountId);
  const regionNodeId = stableId('region', accountId, region);
  if (!nodes.some((node) => node.id === accountNodeId)) nodes.push({ ...boundaryBase(accountNodeId, accountId === 'unresolved' ? 'Unresolved account' : `Account ${accountId}`, { x: 60, y: 60 }, { width: 1400, height: 900 }), kind: 'boundary', boundaryType: 'account', accountId, placementConfidence: accountId === 'unresolved' ? 'unresolved' : 'high' });
  nodes.push({ ...boundaryBase(regionNodeId, region === 'unresolved' ? 'Unresolved Region' : region, { x: 40, y: 80 }, { width: 1280, height: 760 }), kind: 'boundary', boundaryType: 'region', accountId, regionName: region, physicalParentId: accountNodeId, placementConfidence: region === 'unresolved' ? 'unresolved' : 'high' });
  const nodeIdByLogicalId: Record<string, string> = {};
  const resourceEntries = Object.entries(template.fidelity.projectedResources).sort(([a], [b]) => a.localeCompare(b));
  for (const [index, [logicalId, projection]] of resourceEntries.entries()) {
    const resource = getResource(projection.origin === 'authored' ? template.resources[logicalId] : projection.resource);
    if (!resource) continue;
    const type = resource.Type as string;
    const id = stableId('node', ownerId, logicalId, type);
    nodeIdByLogicalId[logicalId] = id;
    const properties = isRecord(resource.Properties) ? resource.Properties : {};
    const position = { x: 80 + templateIndex * 460 + (index % 4) * 220, y: 140 + Math.floor(index / 4) * 130 };
    const ownership = ownerKind === 'stack' ? { stackId: ownerId } : { stackSetId: ownerId };
    const fidelity = {
      sourcePropertyPath: projection.sourcePath,
      ...(projection.origin === 'foreach' ? { sourceProjection: { kind: 'foreach' as const, loopName: projection.loopName ?? 'unknown', iterationValue: projection.iterationValue ?? '', sourcePath: projection.sourcePath } } : {}),
      ...(template.fidelity.cdkConstructPaths[logicalId] ? { cdkConstructPath: template.fidelity.cdkConstructPaths[logicalId] } : {}),
      ...(template.fidelity.cdkHelperLogicalIds.includes(logicalId) ? { cdkHelper: true } : {}),
    };
    if (type === 'AWS::EC2::VPC') {
      nodes.push({ ...boundaryBase(id, logicalId, position, { width: 980, height: 560 }), kind: 'boundary', boundaryType: 'vpc', physicalParentId: regionNodeId, sourceTemplateId: template.id, sourceLogicalId: logicalId, sourceResourceType: type, cloudFormation: editableResource(resource, properties), importStatus: 'imported', placementConfidence: 'high', ...ownership, ...fidelity, ...(typeof properties.CidrBlock === 'string' ? { cidr: properties.CidrBlock } : {}) });
    } else if (type === 'AWS::EC2::Subnet') {
      const azName = typeof properties.AvailabilityZone === 'string' ? properties.AvailabilityZone : `${region}?`;
      const azId = stableId('az', accountId, region, azName);
      if (!nodes.some((node) => node.id === azId)) nodes.push({ ...boundaryBase(azId, azName, { x: 32, y: 80 }, { width: 900, height: 230 }), kind: 'boundary', boundaryType: 'availability-zone', physicalParentId: regionNodeId, accountId, regionName: region, availabilityZoneName: azName, placementConfidence: azName.endsWith('?') ? 'low' : 'high' });
      nodes.push({ ...boundaryBase(id, logicalId, position, { width: 400, height: 170 }), kind: 'boundary', boundaryType: 'subnet', physicalParentId: azId, sourceTemplateId: template.id, sourceLogicalId: logicalId, sourceResourceType: type, cloudFormation: editableResource(resource, properties), importStatus: 'imported', placementConfidence: 'medium', availabilityZoneName: azName, ...ownership, ...fidelity, ...(typeof properties.CidrBlock === 'string' ? { cidr: properties.CidrBlock } : {}) });
    } else {
      nodes.push({ ...resourceBase(id, logicalId, position), kind: 'aws-resource', resourceType: RESOURCE_TYPE_MAP[type] ?? 'cloudformation-generic', cloudFormationType: type, properties, physicalParentId: regionNodeId, sourceTemplateId: template.id, sourceLogicalId: logicalId, sourceResourceType: type, importStatus: 'imported', placementConfidence: RESOURCE_TYPE_MAP[type] ? 'medium' : 'low', ...ownership, ...fidelity, ...(typeof resource.Condition === 'string' ? { condition: resource.Condition } : {}), ...(isRecord(resource.Metadata) ? { metadata: resource.Metadata } : {}), ...(typeof resource.DeletionPolicy === 'string' ? { deletionPolicy: resource.DeletionPolicy } : {}), ...(typeof resource.UpdateReplacePolicy === 'string' ? { updateReplacePolicy: resource.UpdateReplacePolicy } : {}) });
    }
  }
  // Ref-based physical placement after every logical ID is known.
  for (const node of nodes) {
    if (node.kind !== 'aws-resource') continue;
    const subnetLogical = ref(node.properties.SubnetId) ?? (Array.isArray(node.properties.SubnetIds) ? ref(node.properties.SubnetIds[0]) : undefined);
    const vpcLogical = ref(node.properties.VpcId);
    const proposed = subnetLogical ? nodeIdByLogicalId[subnetLogical] : vpcLogical ? nodeIdByLogicalId[vpcLogical] : undefined;
    placements.push({ nodeId: node.id, ...(proposed ? { proposedParentId: proposed } : { proposedParentId: regionNodeId }), confidence: proposed ? 'high' : 'medium', rationale: proposed ? 'Placement inferred from CloudFormation network reference.' : 'Placed at Region scope because no physical network reference was found.', candidates: proposed ? [proposed] : [regionNodeId] });
  }
  const placementById = Object.fromEntries(placements.map((placement) => [placement.nodeId, placement]));
  return { nodes: nodes.map((node) => {
    const placement = placementById[node.id];
    return node.kind === 'aws-resource' && placement?.proposedParentId ? { ...node, physicalParentId: placement.proposedParentId } : node;
  }), placements, nodeIdByLogicalId };
}

/** Creates an unresolved external-reference node for an intrinsic target. */
function externalNode(template: CloudFormationTemplateRecord, reference: IntrinsicReference, index: number): ExternalReferenceNode {
  const id = stableId('external', template.id, reference.target, reference.relationshipType);
  return {
    id, name: reference.target, kind: 'external-reference', referenceType: reference.relationshipType === 'imports-cloudformation-output' ? 'cloudformation-export' : 'resource', referenceValue: reference.target, resolved: false,
    position: { x: 1100, y: 120 + index * 96 }, size: { width: 200, height: 70 }, logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], sourceTemplateId: template.id,
    locked: false, pinned: false, collapsed: false, zIndex: 15, userMetadata: {}, diagramTags: {}, annotations: [], importStatus: 'imported', placementConfidence: 'unresolved',
  };
}

/** Empty stack metadata used when an association must be resolved graphically. */
function emptyMetadata(): StackMetadata {
  return { parameters: {}, outputs: {}, tags: {}, physicalIds: {} };
}

/** Merges describe/list records that identify the same deployed stack. */
function mergeMetadata(records: readonly StackMetadata[]): StackMetadata {
  return records.reduce<StackMetadata>((combined, record) => ({
    ...combined,
    ...record,
    parameters: { ...combined.parameters, ...record.parameters },
    outputs: { ...combined.outputs, ...record.outputs },
    tags: { ...combined.tags, ...record.tags },
    physicalIds: { ...combined.physicalIds, ...record.physicalIds },
  }), emptyMetadata());
}

/** Selects metadata by stable identity and filename evidence, never by file position. */
function metadataForTemplate(metadata: readonly StackMetadata[], templateFilename: string): StackMetadata {
  if (metadata.length === 0) return emptyMetadata();
  const grouped = new Map<string, StackMetadata[]>();
  metadata.forEach((record, index) => {
    const key = record.stackId ?? record.stackName ?? `source:${record.sourceFilename ?? index}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  });
  const choices = [...grouped.values()].map(mergeMetadata);
  if (choices.length === 1) return choices[0] ?? emptyMetadata();
  const stem = filenameStem(templateFilename).replace(/[^a-z0-9]/g, '');
  const scored = choices.map((record) => {
    const name = (record.stackName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const source = filenameStem(record.sourceFilename ?? '').replace(/^(describe|list|stack|resources?)[-_]?/, '').replace(/[^a-z0-9]/g, '');
    const score = name && (stem === name || stem.includes(name) || name.includes(stem)) ? 100 : source && (stem.includes(source) || source.includes(stem)) ? 40 : 0;
    return { record, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score > 0 && best.score > (scored[1]?.score ?? -1) ? best.record : emptyMetadata();
}

/** Derives editable desired target groups from observed StackSet instances. */
function targetGroupsFromInstances(instances: readonly StackInstance[], stackSetId: string): StackSetTargetGroup[] {
  const groups = new Map<string, StackInstance[]>();
  for (const instance of instances) {
    const key = JSON.stringify(instance.parameterOverrides);
    groups.set(key, [...(groups.get(key) ?? []), instance]);
  }
  return [...groups.entries()].map(([key, values], index) => ({
    id: stableId('stackset-target', stackSetId, String(index), key),
    accounts: [...new Set(values.map((instance) => instance.accountId))].sort(),
    organizationalUnitIds: [],
    regions: [...new Set(values.map((instance) => instance.region))].sort(),
    parameterOverrides: values[0]?.parameterOverrides ?? {},
  }));
}

/** Filters uploaded sources down to likely CloudFormation templates. */
function templateCandidateFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((file) => {
    if (/manifest|(?:^|\/)tree\.json$|\.assets\.json$|describe-stacks|list-stack-resources|list-stack-instances|describe-stack-set|change-set|stack-policy|resource-drifts/i.test(file.name)) return false;
    const parsed = parseJson(file);
    if (isRecord(parsed) && (Array.isArray(parsed.Stacks) || Array.isArray(parsed.Summaries) || isRecord(parsed.StackSet) || Array.isArray(parsed.StackResourceSummaries))) return 'TemplateBody' in parsed;
    return true;
  });
}

/** Reads a CloudFormation export-name expression from an output object. */
function outputExportName(raw: unknown): unknown | undefined {
  if (!isRecord(raw) || !isRecord(raw.Export)) return undefined;
  return raw.Export.Name;
}

function templateExpressionContext(template: CloudFormationTemplateRecord, group?: DeploymentGroup) {
  const parameterDefaults = Object.fromEntries(Object.entries(template.parameters).flatMap(([name, raw]) => isRecord(raw) && 'Default' in raw ? [[name, raw.Default]] : []));
  const stack = group?.kind === 'stack' ? group : undefined;
  return { parameters: parameterDefaults, mappings: template.mappings, pseudoParameters: { 'AWS::StackName': group?.name ?? '', 'AWS::Region': stack?.region ?? '', 'AWS::AccountId': stack?.accountId ?? '', 'AWS::Partition': 'aws' } };
}

function expressionKeys(value: unknown, template: CloudFormationTemplateRecord, group?: DeploymentGroup): string[] {
  const resolved = evaluateStaticExpression(value, templateExpressionContext(template, group));
  return [...new Set([...(resolved !== undefined ? [`value:${resolved}`] : []), `ast:${expressionFingerprint(value)}`])];
}

/** Reads the logical resource targeted by an output value. */
function outputResourceTarget(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const value = raw.Value;
  if (isRecord(value) && typeof value.Ref === 'string') return value.Ref;
  if (isRecord(value) && 'Fn::GetAtt' in value) {
    const getAtt = value['Fn::GetAtt'];
    if (typeof getAtt === 'string') return getAtt.split('.')[0];
    if (Array.isArray(getAtt) && typeof getAtt[0] === 'string') return getAtt[0];
  }
  return undefined;
}

/** Rewrites unresolved import-value edges when a matching exported output is present. */
function resolveCrossStackExports(
  templates: readonly CloudFormationTemplateRecord[],
  groups: readonly DeploymentGroup[],
  nodes: Map<string, DiagramNode>,
  edges: Map<string, DiagramEdge>,
  diagnostics: CloudFormationImportDiagnostic[],
): void {
  const providers = new Map<string, { nodeId: string; filename: string; group?: DeploymentGroup; expression: unknown }[]>();
  for (const template of templates) {
    const group = groups.find((candidate) => candidate.templateId === template.id && candidate.kind !== 'nested-stack');
    for (const rawOutput of Object.values(template.fidelity.projectedOutputs)) {
      const exportName = outputExportName(rawOutput);
      const logicalId = outputResourceTarget(rawOutput);
      if (!exportName || !logicalId) continue;
      const node = [...nodes.values()].find((candidate) => candidate.sourceTemplateId === template.id && candidate.sourceLogicalId === logicalId);
      if (!node) continue;
      for (const key of expressionKeys(exportName, template, group)) {
        const list = providers.get(key) ?? [];
        list.push({ nodeId: node.id, filename: template.originalFilename, group, expression: exportName });
        providers.set(key, list);
      }
    }
  }
  for (const [edgeId, edge] of edges) {
    if (edge.relationshipType !== 'imports-cloudformation-output') continue;
    const external = nodes.get(edge.target);
    if (external?.kind !== 'external-reference') continue;
    const consumerTemplate = edge.sourceTemplateId ? templates.find((template) => template.id === edge.sourceTemplateId) : undefined;
    const consumerGroup = consumerTemplate ? groups.find((candidate) => candidate.templateId === consumerTemplate.id && candidate.kind !== 'nested-stack') : undefined;
    const targetExpression = edge.metadata.targetExpression ?? external.referenceValue;
    const keys = consumerTemplate ? expressionKeys(targetExpression, consumerTemplate, consumerGroup) : [`value:${external.referenceValue}`, `ast:${external.referenceValue}`];
    const matches = [...new Map(keys.flatMap((key) => providers.get(key) ?? []).map((match) => [match.nodeId, match])).values()];
    if (matches.length === 1) {
      const provider = matches[0];
      if (!provider) continue;
      const providerStack = provider.group?.kind === 'stack' ? provider.group : undefined;
      const consumerStack = consumerGroup?.kind === 'stack' ? consumerGroup : undefined;
      const importValue = edge.label === 'Fn::ImportValue';
      const contextKnown = providerStack?.accountId && providerStack.region && consumerStack?.accountId && consumerStack.region && ![providerStack.accountId, providerStack.region, consumerStack.accountId, consumerStack.region].includes('unresolved');
      const mismatch = Boolean(importValue && contextKnown && (providerStack?.accountId !== consumerStack?.accountId || providerStack?.region !== consumerStack?.region));
      edges.set(edgeId, {
        ...edge,
        target: provider.nodeId,
        description: `Imports CloudFormation export ${external.referenceValue} from ${provider.filename}.`,
        metadata: { ...edge.metadata, exportName: provider.expression as JsonValue },
        validationStatus: mismatch ? 'error' : contextKnown || !importValue ? 'valid' : 'warning',
      });
      if (mismatch) diagnostics.push({ id: stableId('diagnostic', edgeId, 'UNSUPPORTED_IMPORTVALUE_CONTEXT'), filename: consumerTemplate?.originalFilename ?? external.referenceValue, severity: 'error', code: 'UNSUPPORTED_IMPORTVALUE_CONTEXT', message: `Fn::ImportValue resolves across different accounts or Regions (${consumerStack?.accountId}/${consumerStack?.region} → ${providerStack?.accountId}/${providerStack?.region}).`, blocking: false, path: edge.sourcePropertyPath });
      else if (importValue && !contextKnown) diagnostics.push({ id: stableId('diagnostic', edgeId, 'IMPORTVALUE_CONTEXT_UNKNOWN'), filename: consumerTemplate?.originalFilename ?? external.referenceValue, severity: 'warning', code: 'IMPORTVALUE_CONTEXT_UNKNOWN', message: 'The matching export was found, but account/Region compatibility cannot be verified.', blocking: false, path: edge.sourcePropertyPath });
    } else if (matches.length > 1) {
      diagnostics.push({
        id: stableId('diagnostic', edgeId, 'AMBIGUOUS_EXPORT'),
        filename: external.referenceValue,
        severity: 'warning',
        code: 'AMBIGUOUS_EXPORT',
        message: `Multiple imported templates export ${external.referenceValue}; the consumer remains unresolved.`,
        blocking: false,
      });
    }
  }
  const referencedTargets = new Set([...edges.values()].map((edge) => edge.target));
  for (const [nodeId, node] of nodes) {
    if (node.kind === 'external-reference' && node.referenceType === 'cloudformation-export' && !referencedTargets.has(nodeId)) nodes.delete(nodeId);
  }
}

/** Creates a normalized, previewable import plan from local CloudFormation files. */
export async function createCloudFormationImportPlan(inputFiles: readonly ImportFile[], options: ImportOptions, onProgress?: ImportProgressCallback): Promise<CloudFormationImportPlan> {
  onProgress?.('expand', 0, Math.max(1, inputFiles.length), 'Expanding selected files.');
  const files = await expandInputFiles(inputFiles);
  onProgress?.('classify', 1, Math.max(1, files.length + 1), `${files.length} source files classified.`);
  const manifest = detectManifest(files);
  const cloudAssembly = detectCloudAssembly(files);
  const deploymentMetadata = detectDeploymentMetadata(files);
  const assignedMetadataIds = new Set<string>();
  const stackMetadata = detectStackMetadata(files);
  const stackSetMetadata = detectStackSetMetadata(files);
  const templates: CloudFormationTemplateRecord[] = [];
  const groups: DeploymentGroup[] = [];
  const instances: StackInstance[] = [];
  const nodes = new Map<string, DiagramNode>();
  const edges = new Map<string, DiagramEdge>();
  const placements: PlacementResolution[] = [];
  const diagnostics: CloudFormationImportDiagnostic[] = [];
  const contentHashes = await Promise.all(files.map((file) => sha256Text(file.text)));
  const sourceIdentity = await sha256Text(files.map((file, index) => `${file.name}:${contentHashes[index] ?? ''}`).join('|'));
  let source: CloudFormationImportSource = { id: stableId('import-source', sourceIdentity), sourceIdentity, filenames: files.map((file) => file.name), importType: options.importType, importedAt: new Date().toISOString(), contentHashes, ...(cloudAssembly ? { cloudAssembly } : {}) };
  const candidates = templateCandidateFiles(files);
  if (stackSetMetadata?.templateBody && candidates.length === 0) {
    candidates.push({ name: `${stackSetMetadata.name ?? 'stackset'}.json`, text: typeof stackSetMetadata.templateBody === 'string' ? stackSetMetadata.templateBody : JSON.stringify(stackSetMetadata.templateBody) });
  }
  for (const [index, file] of candidates.entries()) {
    onProgress?.('parse', index, Math.max(1, candidates.length), `Parsing ${file.name}.`);
    const manifestEntry = manifest?.templates.find((entry) => entry.filename === file.name);
    const assemblyArtifact = cloudAssembly?.artifacts.find((artifact) => artifact.type === 'aws:cloudformation:stack' && artifact.templateFile && (file.name === artifact.templateFile || file.name.endsWith(`/${artifact.templateFile}`)));
    const metadata = metadataForTemplate(stackMetadata, file.name);
    const overrideName = options.stackNameOverrides?.[file.name];
    const filenameIdentity = file.name.replace(/\.(json|ya?ml)$/i, '');
    const isStackSet = options.importType === 'stackset' || Boolean(manifestEntry?.stackSetId) || Boolean(stackSetMetadata);
    const assemblyIdentity = assemblyArtifact?.id;
    const ownerId = isStackSet
      ? stableId('stackset', manifestEntry?.stackSetId ?? stackSetMetadata?.id ?? overrideName ?? stackSetMetadata?.name ?? filenameIdentity)
      : stableId('stack', manifestEntry?.stackId ?? metadata.stackId ?? overrideName ?? manifestEntry?.stackName ?? metadata.stackName ?? assemblyIdentity ?? filenameIdentity);
    const parsed = await parseCloudFormationTemplate(file, isStackSet ? { stackSetId: ownerId } : { stackId: ownerId });
    diagnostics.push(...parsed.diagnostics);
    if (!parsed.record) continue;
    templates.push(parsed.record);
    const environment = assemblyArtifact?.environment?.match(/^aws:\/\/([^/]+)\/(.+)$/);
    const accountId = manifestEntry?.accountId ?? metadata.accountId ?? environment?.[1] ?? options.defaultAccountId ?? 'unresolved';
    const region = manifestEntry?.region ?? metadata.region ?? environment?.[2] ?? options.defaultRegion ?? 'unresolved';
    const explicitMetadataFiles: readonly { filename: string; kind: DeploymentMetadataArtifact['kind'] }[] = manifestEntry && 'metadataFiles' in manifestEntry ? (manifestEntry as { metadataFiles?: readonly { filename: string; kind: DeploymentMetadataArtifact['kind'] }[] }).metadataFiles ?? [] : [];
    const groupDeploymentMetadata = deploymentMetadata.flatMap((artifact) => {
      const explicit = explicitMetadataFiles.some((entry) => entry.filename === artifact.originalFilename && entry.kind === artifact.kind);
      const identity = Boolean(artifact.stackId && metadata.stackId === artifact.stackId || artifact.stackName && (metadata.stackName === artifact.stackName || manifestEntry?.stackName === artifact.stackName));
      const single = candidates.length === 1;
      const associationEvidence: DeploymentMetadataArtifact['associationEvidence'] = explicit ? 'manifest' : identity ? 'stack-identity' : single ? 'single-stack' : undefined;
      if (!associationEvidence) return [];
      assignedMetadataIds.add(artifact.id);
      return [{ ...artifact, associationEvidence }];
    });
    if (isStackSet) {
      const detectedInstances = detectStackInstances(files, ownerId);
      const group: StackSetDeploymentGroup = { id: ownerId, name: overrideName ?? manifestEntry?.stackName ?? stackSetMetadata?.name ?? file.name.replace(/\.(json|ya?ml)$/i, ''), kind: 'stackset', nodeIds: [], templateId: parsed.record.id, unresolvedTargets: true, targetGroups: targetGroupsFromInstances(detectedInstances, ownerId), metadata: {}, ...(stackSetMetadata?.permissionModel ? { permissionModel: stackSetMetadata.permissionModel } : {}) };
      instances.push(...detectedInstances);
      groups.push({ ...group, unresolvedTargets: detectedInstances.length === 0 });
      if (detectedInstances.length === 0) diagnostics.push({ id: stableId('diagnostic', file.name, 'STACKSET_TARGETS_UNRESOLVED'), filename: file.name, severity: 'warning', code: 'STACKSET_TARGETS_UNRESOLVED', message: 'The StackSet has no instance summaries; deployment targets remain unresolved.', blocking: false });
      const projectionAccount = detectedInstances[0]?.accountId ?? accountId;
      const projectionRegion = detectedInstances[0]?.region ?? region;
      const built = buildTemplateNodes(parsed.record, ownerId, 'stackset', projectionAccount, projectionRegion, index);
      built.nodes.forEach((node) => nodes.set(node.id, node));
      placements.push(...built.placements);
      const refs = analyzeIntrinsicReferences(parsed.record);
      const external = refs.filter((reference) => reference.external).map((reference, refIndex) => externalNode(parsed.record as CloudFormationTemplateRecord, reference, refIndex));
      external.forEach((node) => nodes.set(node.id, node));
      referencesToEdges(parsed.record, built.nodeIdByLogicalId, (reference) => stableId('external', parsed.record?.id ?? '', reference.target, reference.relationshipType)).forEach((edge) => edges.set(edge.id, edge));
      const nodeIds = built.nodes.filter((node) => node.sourceTemplateId === parsed.record?.id).map((node) => node.id);
      groups[groups.length - 1] = { ...(groups[groups.length - 1] as StackSetDeploymentGroup), nodeIds };
      for (const instance of detectedInstances) {
        const accountNodeId = stableId('account', instance.accountId);
        const regionNodeId = stableId('region', instance.accountId, instance.region);
        if (!nodes.has(accountNodeId)) nodes.set(accountNodeId, { ...boundaryBase(accountNodeId, `Account ${instance.accountId}`, { x: 60 + instances.indexOf(instance) * 80, y: 60 }, { width: 1400, height: 900 }), kind: 'boundary', boundaryType: 'account', accountId: instance.accountId, placementConfidence: 'high' });
        if (!nodes.has(regionNodeId)) nodes.set(regionNodeId, { ...boundaryBase(regionNodeId, instance.region, { x: 40, y: 80 }, { width: 1280, height: 760 }), kind: 'boundary', boundaryType: 'region', accountId: instance.accountId, regionName: instance.region, physicalParentId: accountNodeId, placementConfidence: 'high' });
      }
    } else {
      const group: StackDeploymentGroup = { id: ownerId, name: overrideName ?? manifestEntry?.stackName ?? metadata.stackName ?? assemblyArtifact?.displayName ?? assemblyArtifact?.id ?? file.name.replace(/\.(json|ya?ml)$/i, ''), kind: 'stack', nodeIds: [], templateId: parsed.record.id, accountId, region, ...(metadata.status ? { status: metadata.status } : {}), parameters: metadata.parameters, outputs: metadata.outputs, tags: metadata.tags, deploymentMetadata: groupDeploymentMetadata, metadata: {} };
      const built = buildTemplateNodes(parsed.record, ownerId, 'stack', accountId, region, index);
      built.nodes.forEach((node) => nodes.set(node.id, node));
      placements.push(...built.placements);
      const refs = analyzeIntrinsicReferences(parsed.record);
      refs.filter((reference) => reference.external).map((reference, refIndex) => externalNode(parsed.record as CloudFormationTemplateRecord, reference, refIndex)).forEach((node) => nodes.set(node.id, node));
      referencesToEdges(parsed.record, built.nodeIdByLogicalId, (reference) => stableId('external', parsed.record?.id ?? '', reference.target, reference.relationshipType)).forEach((edge) => edges.set(edge.id, edge));
      groups.push({ ...group, nodeIds: built.nodes.filter((node) => node.sourceTemplateId === parsed.record?.id).map((node) => node.id) });
      for (const nestedNode of built.nodes.filter((node): node is AwsResourceNode => node.kind === 'aws-resource' && node.resourceType === 'nested-stack')) {
        const templateUrl = asString(nestedNode.properties.TemplateURL);
        const nestedGroup: NestedStackDeploymentGroup = {
          id: stableId('nested-stack-group', ownerId, nestedNode.sourceLogicalId ?? nestedNode.id),
          name: nestedNode.name,
          kind: 'nested-stack',
          parentStackId: ownerId,
          parentResourceNodeId: nestedNode.id,
          nodeIds: [nestedNode.id],
          parameters: isRecord(nestedNode.properties.Parameters) ? nestedNode.properties.Parameters : {},
          unresolvedTemplate: true,
          associationConfirmed: false,
          metadata: {},
          ...(templateUrl ? { templateUrl } : {}),
        };
        groups.push(nestedGroup);
        if (templateUrl) {
          const externalId = stableId('external-template-url', parsed.record.id, templateUrl);
          nodes.set(externalId, {
            ...resourceBase(externalId, templateUrl, { x: nestedNode.position.x + 260, y: nestedNode.position.y }),
            kind: 'external-reference', referenceType: 'template-url', referenceValue: templateUrl, resolved: false,
            sourceTemplateId: parsed.record.id, importStatus: 'imported', placementConfidence: 'unresolved',
          });
          const nestedEdge: DiagramEdge = {
            id: stableId('edge', parsed.record.id, nestedNode.id, externalId, 'nested-stack'), source: nestedNode.id, target: externalId,
            relationshipType: 'nested-stack', label: 'TemplateURL', direction: 'forward', metadata: {},
            sourcePropertyPath: `Resources.${nestedNode.sourceLogicalId ?? nestedNode.name}.Properties.TemplateURL`, sourceTemplateId: parsed.record.id, validationStatus: 'unresolved',
          };
          edges.set(nestedEdge.id, nestedEdge);
        }
        diagnostics.push({
          id: stableId('diagnostic', parsed.record.id, nestedNode.id, 'NESTED_TEMPLATE_UNRESOLVED'), filename: file.name,
          severity: 'warning', code: 'NESTED_TEMPLATE_UNRESOLVED', message: `Nested stack ${nestedNode.name} has no locally associated child template.`, blocking: false,
          path: `$.Resources.${nestedNode.sourceLogicalId ?? nestedNode.name}.Properties.TemplateURL`,
        });
      }
    }
  }
  onProgress?.('analyze', candidates.length, Math.max(1, candidates.length), 'Analyzing dependencies and deployment metadata.');
  resolveCrossStackExports(templates, groups, nodes, edges, diagnostics);
  const unassociatedDeploymentMetadata = deploymentMetadata.filter((artifact) => !assignedMetadataIds.has(artifact.id)).map((artifact) => ({ ...artifact, associationEvidence: 'unassociated' as const }));
  if (unassociatedDeploymentMetadata.length > 0) {
    source = { ...source, unassociatedDeploymentMetadata };
    diagnostics.push({ id: stableId('diagnostic', source.id, 'UNASSOCIATED_DEPLOYMENT_METADATA'), filename: unassociatedDeploymentMetadata.map((artifact) => artifact.originalFilename).join(', '), severity: 'warning', code: 'UNASSOCIATED_DEPLOYMENT_METADATA', message: `${unassociatedDeploymentMetadata.length} deployment metadata artifact${unassociatedDeploymentMetadata.length === 1 ? '' : 's'} could not be associated with a stack and will be preserved as unassociated.`, blocking: false });
  }
  if (candidates.length === 0) diagnostics.push({ id: uniqueId('diagnostic'), filename: files.map((file) => file.name).join(', '), severity: 'error', code: 'NO_TEMPLATE_FOUND', message: 'No CloudFormation template was detected in the selected files.', blocking: true });
  const unsupportedResourceCount = templates.reduce((count, template) => count + Object.values(template.resources).filter((raw) => getResource(raw)?.Type && !RESOURCE_TYPE_MAP[String(getResource(raw)?.Type)] && String(getResource(raw)?.Type) !== 'AWS::EC2::VPC' && String(getResource(raw)?.Type) !== 'AWS::EC2::Subnet').length, 0);
  return {
    id: stableId('import-plan', source.id), source, templates, deploymentGroups: groups, stackInstances: instances, nodes: [...nodes.values()], edges: [...edges.values()], diagnostics,
    placementResolutions: placements, collisions: [],
    summary: { fileCount: files.length, stackCount: groups.filter((group) => group.kind === 'stack').length, stackSetCount: groups.filter((group) => group.kind === 'stackset').length, instanceCount: instances.length, resourceCount: templates.reduce((sum, template) => sum + Object.keys(template.fidelity.projectedResources).length, 0), relationshipCount: edges.size, unresolvedReferenceCount: [...edges.values()].filter((edge) => edge.validationStatus === 'unresolved').length, unsupportedResourceCount },
  };
}

function filenameStem(value: string): string {
  const name = value.split(/[?#]/, 1)[0]?.replaceAll('\\', '/').split('/').at(-1) ?? value;
  return name.replace(/\.(json|ya?ml)$/i, '').toLowerCase();
}

/** Normalizes local paths and TemplateURL paths for deterministic suffix comparison. */
function normalizedTemplatePath(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value;
  const withoutOrigin = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '');
  return withoutOrigin.replaceAll('\\', '/').replace(/^\/+/, '').toLowerCase();
}

function uniqueCandidates(candidates: readonly ImportAssociationCandidate[]): ImportAssociationCandidate[] {
  const unique = new Map<string, ImportAssociationCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.templateId}|${candidate.ownerKind}|${candidate.ownerId}`;
    const current = unique.get(key);
    if (!current || ['low', 'medium', 'high'].indexOf(candidate.confidence) > ['low', 'medium', 'high'].indexOf(current.confidence)) unique.set(key, candidate);
  }
  return [...unique.values()];
}

/** Parses once and discovers graphical association choices for a later immutable plan build. */
export async function analyzeCloudFormationImport(
  inputFiles: readonly ImportFile[],
  options: ImportOptions,
  onProgress?: ImportProgressCallback,
): Promise<CloudFormationImportAnalysis> {
  const expanded = await expandInputFiles(inputFiles);
  const normalizedInputs = expanded.map((file) => ({ name: file.name, data: file.text }));
  const draftPlan = await createCloudFormationImportPlan(normalizedInputs, options, onProgress);
  const manifest = detectManifest(expanded);
  const metadata = detectStackMetadata(expanded);
  const candidates: ImportAssociationCandidate[] = [];
  for (const template of draftPlan.templates) {
    const group = draftPlan.deploymentGroups.find((item) => item.kind !== 'nested-stack' && item.templateId === template.id);
    if (group && group.kind !== 'nested-stack') {
      const manifestEntry = manifest?.templates.find((entry) => entry.filename === template.originalFilename);
      const unresolved = group.kind === 'stack' && (group.accountId === 'unresolved' || group.region === 'unresolved');
      const confidence: ImportAssociationCandidate['confidence'] = manifestEntry ? 'high' : unresolved ? 'low' : 'medium';
      candidates.push({
        id: stableId('association-candidate', template.id, group.id), templateId: template.id, ownerKind: group.kind === 'stackset' ? 'stackset' : 'stack', ownerId: group.id, name: group.name,
        ...(group.kind === 'stack' && group.accountId ? { accountId: group.accountId } : {}), ...(group.kind === 'stack' && group.region ? { region: group.region } : {}),
        confidence, evidence: manifestEntry ? ['Explicit import manifest entry.'] : unresolved ? ['Filename-derived identity; deployment metadata is incomplete.'] : ['Detected AWS metadata or import defaults.'],
      });
    }
    for (const stack of metadata) {
      const identity = stack.stackId ?? stack.stackName;
      if (!identity) continue;
      const nameMatch = stack.stackName && filenameStem(template.originalFilename).includes(stack.stackName.toLowerCase());
      candidates.push({
        id: stableId('association-candidate', template.id, identity), templateId: template.id, ownerKind: 'stack', ownerId: stableId('stack', identity), name: stack.stackName ?? filenameStem(template.originalFilename),
        ...(stack.accountId ? { accountId: stack.accountId } : {}), ...(stack.region ? { region: stack.region } : {}), confidence: nameMatch ? 'high' : 'low',
        evidence: [nameMatch ? 'Template filename matches StackName.' : 'AWS stack metadata is available but not uniquely matched.'], ...(stack.sourceFilename ? { metadataSource: stack.sourceFilename } : {}),
      });
    }
  }
  const associationCandidates = uniqueCandidates(candidates);
  const nestedAssociationCandidates: NestedAssociationCandidate[] = [];
  for (const nested of draftPlan.deploymentGroups.filter((group): group is NestedStackDeploymentGroup => group.kind === 'nested-stack')) {
    const parentNode = draftPlan.nodes.find((node) => node.id === nested.parentResourceNodeId);
    if (!parentNode?.sourceTemplateId || !parentNode.sourceLogicalId) continue;
    const parentTemplate = draftPlan.templates.find((template) => template.id === parentNode.sourceTemplateId);
    const parentMetadata = metadataForTemplate(metadata, parentTemplate?.originalFilename ?? '');
    const childPhysicalId = parentMetadata.physicalIds[parentNode.sourceLogicalId];
    const urlPath = normalizedTemplatePath(nested.templateUrl ?? '');
    const urlStem = filenameStem(urlPath);
    const manifestChildren = manifest?.templates.filter((entry) => entry.parentStackId && [nested.parentStackId, draftPlan.deploymentGroups.find((group) => group.id === nested.parentStackId)?.name].includes(entry.parentStackId)) ?? [];
    for (const child of draftPlan.templates.filter((template) => template.id !== parentNode.sourceTemplateId)) {
      const evidence: string[] = [];
      let score = 0;
      const childPath = normalizedTemplatePath(child.originalFilename);
      if (urlPath && childPath && urlPath.endsWith(childPath)) { score += 90; evidence.push('Normalized TemplateURL path matches the child template path.'); }
      else if (urlStem && filenameStem(child.originalFilename) === urlStem) { score += 80; evidence.push('TemplateURL basename matches the child filename.'); }
      if (manifestChildren.some((entry) => entry.filename === child.originalFilename)) { score += 100; evidence.push('Manifest parentStackId identifies this child.'); }
      const childMetadata = metadataForTemplate(metadata, child.originalFilename);
      if (childPhysicalId && childMetadata.stackId === childPhysicalId || parentMetadata.stackId && childMetadata.parentId === parentMetadata.stackId) {
        score += 100; evidence.push('AWS StackId/ParentId metadata identifies this parent and child.');
      } else if (parentMetadata.rootId && childMetadata.rootId === parentMetadata.rootId && childMetadata.stackId !== parentMetadata.stackId) {
        score += 45; evidence.push('AWS RootId metadata places this template in the same nested-stack tree.');
      }
      const supplied = parentNode.kind === 'aws-resource' && isRecord(parentNode.properties.Parameters) ? Object.keys(parentNode.properties.Parameters) : [];
      const accepted = Object.keys(child.parameters);
      const overlap = supplied.filter((key) => accepted.includes(key)).length;
      if (overlap > 0) { score += Math.min(20, overlap * 5); evidence.push(`${overlap} parent parameter name${overlap === 1 ? '' : 's'} match the child template.`); }
      if (score === 0 && filenameStem(child.originalFilename).includes(parentNode.sourceLogicalId.toLowerCase())) { score += 40; evidence.push('Child filename resembles the nested logical ID.'); }
      nestedAssociationCandidates.push({ id: stableId('nested-candidate', nested.id, child.id), parentTemplateId: parentNode.sourceTemplateId, parentLogicalId: parentNode.sourceLogicalId, childTemplateId: child.id, score, confidence: score >= 80 ? 'high' : score >= 40 ? 'medium' : 'low', evidence: evidence.length ? evidence : ['No strong filename or metadata match.'] });
    }
  }
  nestedAssociationCandidates.sort((a, b) => b.score - a.score || a.childTemplateId.localeCompare(b.childTemplateId));
  const requiresAssociationConfirmation = [
    ...(options.importType === 'multi-stack' ? draftPlan.templates.filter((template) => {
      const rank = { low: 0, medium: 1, high: 2 } as const;
      const choices = associationCandidates.filter((candidate) => candidate.templateId === template.id).sort((a, b) => rank[b.confidence] - rank[a.confidence]);
      const best = choices[0]; const second = choices[1];
      return best?.confidence === 'low' || Boolean(best && second && best.confidence === second.confidence);
    }).map((template) => template.id) : []),
    ...draftPlan.deploymentGroups.filter((group) => group.kind === 'nested-stack').map((group) => group.id),
  ];
  return { id: stableId('import-analysis', draftPlan.id), source: draftPlan.source, templates: draftPlan.templates, diagnostics: draftPlan.diagnostics, associationCandidates, nestedAssociationCandidates, requiresAssociationConfirmation, draftPlan };
}

function associationDiagnostic(code: string, message: string, blocking = true): CloudFormationImportDiagnostic {
  return { id: stableId('diagnostic', code, message), filename: 'association workflow', severity: blocking ? 'error' : 'warning', code, message, blocking };
}

/** Applies graphical association decisions without reading or parsing source files again. */
export function buildCloudFormationImportPlanFromAnalysis(
  analysis: CloudFormationImportAnalysis,
  resolutions: readonly ImportAssociationResolution[],
  nestedResolutions: readonly NestedAssociationResolution[],
): CloudFormationImportPlan {
  const plan = analysis.draftPlan;
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  const edges = new Map(plan.edges.map((edge) => [edge.id, edge]));
  const groups = new Map(plan.deploymentGroups.map((group) => [group.id, group]));
  const diagnostics = [...plan.diagnostics];
  const idRemap = new Map<string, string>();
  const supersededBoundaryIds = new Set<string>();
  for (const template of plan.templates) {
    const hasOwner = plan.deploymentGroups.some((group) => group.kind !== 'nested-stack' && group.templateId === template.id);
    if (hasOwner && !resolutions.some((resolution) => resolution.templateId === template.id)) diagnostics.push(associationDiagnostic('ASSOCIATION_RESOLUTION_REQUIRED', `${template.originalFilename} requires a deployment association resolution.`));
  }
  for (const resolution of resolutions) {
    const current = [...groups.values()].find((group) => group.kind !== 'nested-stack' && group.templateId === resolution.templateId);
    if (!current || current.kind === 'nested-stack') continue;
    if (analysis.requiresAssociationConfirmation.includes(resolution.templateId) && !resolution.confirmed) diagnostics.push(associationDiagnostic('ASSOCIATION_CONFIRMATION_REQUIRED', `${resolution.name} must be explicitly confirmed.`));
    groups.delete(current.id);
    idRemap.set(current.id, resolution.ownerId);
    const nodeIds = current.nodeIds;
    if (resolution.ownerKind === 'stackset') {
      const previous = current.kind === 'stackset' ? current : undefined;
      groups.set(resolution.ownerId, { id: resolution.ownerId, name: resolution.name, kind: 'stackset', templateId: resolution.templateId, nodeIds, unresolvedTargets: previous?.unresolvedTargets ?? true, targetGroups: previous?.targetGroups ?? [], ...(previous?.operationPreferences ? { operationPreferences: previous.operationPreferences } : {}), ...(previous?.permissionModel ? { permissionModel: previous.permissionModel } : {}), metadata: current.metadata });
    } else {
      const previous = current.kind === 'stack' ? current : undefined;
      groups.set(resolution.ownerId, { id: resolution.ownerId, name: resolution.name, kind: 'stack', templateId: resolution.templateId, nodeIds, ...(resolution.accountId ? { accountId: resolution.accountId } : {}), ...(resolution.region ? { region: resolution.region } : {}), parameters: previous?.parameters ?? {}, outputs: previous?.outputs ?? {}, tags: previous?.tags ?? {}, deploymentMetadata: previous?.deploymentMetadata ?? [], metadata: current.metadata });
    }
    const previousStack = current.kind === 'stack' ? current : undefined;
    const previousAccountId = previousStack?.accountId ?? 'unresolved';
    const previousRegion = previousStack?.region ?? 'unresolved';
    const nextAccountId = resolution.accountId ?? previousAccountId;
    const nextRegion = resolution.region ?? previousRegion;
    const previousAccountNodeId = stableId('account', previousAccountId);
    const previousRegionNodeId = stableId('region', previousAccountId, previousRegion);
    const nextAccountNodeId = stableId('account', nextAccountId);
    const nextRegionNodeId = stableId('region', nextAccountId, nextRegion);
    if (resolution.ownerKind === 'stack' && (previousAccountNodeId !== nextAccountNodeId || previousRegionNodeId !== nextRegionNodeId)) {
      if (!nodes.has(nextAccountNodeId)) nodes.set(nextAccountNodeId, { ...boundaryBase(nextAccountNodeId, nextAccountId === 'unresolved' ? 'Unresolved account' : `Account ${nextAccountId}`, { x: 60, y: 60 }, { width: 1400, height: 900 }), kind: 'boundary', boundaryType: 'account', accountId: nextAccountId, placementConfidence: nextAccountId === 'unresolved' ? 'unresolved' : 'high' });
      if (!nodes.has(nextRegionNodeId)) nodes.set(nextRegionNodeId, { ...boundaryBase(nextRegionNodeId, nextRegion === 'unresolved' ? 'Unresolved Region' : nextRegion, { x: 40, y: 80 }, { width: 1280, height: 760 }), kind: 'boundary', boundaryType: 'region', accountId: nextAccountId, regionName: nextRegion, physicalParentId: nextAccountNodeId, placementConfidence: nextRegion === 'unresolved' ? 'unresolved' : 'high' });
      supersededBoundaryIds.add(previousAccountNodeId); supersededBoundaryIds.add(previousRegionNodeId);
    }
    for (const [id, node] of nodes) {
      if (node.sourceTemplateId !== resolution.templateId) continue;
      let physicalParentId = node.physicalParentId;
      if (resolution.ownerKind === 'stack' && previousRegionNodeId !== nextRegionNodeId) {
        if (physicalParentId === previousRegionNodeId) physicalParentId = nextRegionNodeId;
        else if (physicalParentId) {
          const parent = nodes.get(physicalParentId);
          if (parent?.kind === 'boundary' && parent.boundaryType === 'availability-zone' && parent.physicalParentId === previousRegionNodeId) {
            const availabilityZone = parent.availabilityZoneName ?? parent.name;
            const nextAvailabilityZoneId = stableId('az', nextAccountId, nextRegion, availabilityZone);
            if (!nodes.has(nextAvailabilityZoneId)) nodes.set(nextAvailabilityZoneId, { ...parent, id: nextAvailabilityZoneId, physicalParentId: nextRegionNodeId, accountId: nextAccountId, regionName: nextRegion });
            supersededBoundaryIds.add(parent.id);
            physicalParentId = nextAvailabilityZoneId;
          }
        }
      }
      const placement = physicalParentId === node.physicalParentId ? {} : { physicalParentId };
      nodes.set(id, resolution.ownerKind === 'stackset' ? { ...node, ...placement, stackId: undefined, stackSetId: resolution.ownerId } as DiagramNode : { ...node, ...placement, stackId: resolution.ownerId, stackSetId: undefined } as DiagramNode);
    }
  }
  for (const [id, group] of groups) if (group.kind === 'nested-stack' && idRemap.has(group.parentStackId)) groups.set(id, { ...group, parentStackId: idRemap.get(group.parentStackId) as string });

  const associatedChildTemplates = new Set<string>();
  for (const nested of plan.deploymentGroups.filter((group): group is NestedStackDeploymentGroup => group.kind === 'nested-stack')) {
    const parent = nodes.get(nested.parentResourceNodeId);
    const hasResolution = parent?.sourceTemplateId && parent.sourceLogicalId && nestedResolutions.some((resolution) => resolution.parentTemplateId === parent.sourceTemplateId && resolution.parentLogicalId === parent.sourceLogicalId);
    if (!hasResolution) diagnostics.push(associationDiagnostic('NESTED_ASSOCIATION_RESOLUTION_REQUIRED', `${nested.name} requires an explicit local-child or no-local-child resolution.`));
  }
  for (const resolution of nestedResolutions) {
    const nested = [...groups.values()].find((group): group is NestedStackDeploymentGroup => {
      if (group.kind !== 'nested-stack') return false;
      const parent = nodes.get(group.parentResourceNodeId);
      return parent?.sourceTemplateId === resolution.parentTemplateId && parent.sourceLogicalId === resolution.parentLogicalId;
    });
    if (!nested) continue;
    if (!resolution.confirmed) diagnostics.push(associationDiagnostic('NESTED_ASSOCIATION_CONFIRMATION_REQUIRED', `${nested.name} requires explicit child-template confirmation.`));
    if (resolution.disposition === 'leave-unresolved' || !resolution.childTemplateId) {
      groups.set(nested.id, { ...nested, associationConfirmed: resolution.confirmed, unresolvedTemplate: true, templateId: undefined });
      continue;
    }
    const childTemplate = plan.templates.find((template) => template.id === resolution.childTemplateId);
    const sourceGroup = [...groups.values()].find((group) => group.kind !== 'nested-stack' && group.templateId === resolution.childTemplateId);
    if (!childTemplate || !sourceGroup) continue;
    associatedChildTemplates.add(childTemplate.id);
    const childNodes = [...nodes.values()].filter((node) => node.sourceTemplateId === childTemplate.id && (node.stackId === sourceGroup.id || node.stackSetId === sourceGroup.id));
    const cloneIds = new Map(childNodes.map((node) => [node.id, stableId('node', nested.id, node.sourceLogicalId ?? node.id, node.sourceResourceType ?? node.kind)]));
    const clonedNodes = childNodes.map((node) => ({ ...node, id: cloneIds.get(node.id) as string, stackId: nested.id, stackSetId: undefined, physicalParentId: node.physicalParentId && cloneIds.has(node.physicalParentId) ? cloneIds.get(node.physicalParentId) : node.physicalParentId } as DiagramNode));
    clonedNodes.forEach((node) => nodes.set(node.id, node));
    for (const edge of [...edges.values()].filter((edge) => cloneIds.has(edge.source) || cloneIds.has(edge.target))) {
      const clone = { ...edge, id: stableId('edge', nested.id, edge.id), source: cloneIds.get(edge.source) ?? edge.source, target: cloneIds.get(edge.target) ?? edge.target };
      edges.set(clone.id, clone);
    }
    groups.set(nested.id, { ...nested, templateId: childTemplate.id, nodeIds: clonedNodes.map((node) => node.id), unresolvedTemplate: false, associationConfirmed: resolution.confirmed });
    const nestedEdge = [...edges.values()].find((edge) => edge.source === nested.parentResourceNodeId && edge.relationshipType === 'nested-stack');
    const target = nestedEdge ? nodes.get(nestedEdge.target) : undefined;
    if (target?.kind === 'external-reference') nodes.set(target.id, { ...target, resolved: true, referenceValue: childTemplate.originalFilename });
    if (nestedEdge) edges.set(nestedEdge.id, { ...nestedEdge, target: nestedEdge.target, description: `Associated local child template ${childTemplate.originalFilename}.`, validationStatus: 'valid' });
  }
  for (const templateId of associatedChildTemplates) {
    const sourceGroups = [...groups.values()].filter((group) => group.kind !== 'nested-stack' && group.templateId === templateId);
    for (const sourceGroup of sourceGroups) {
      groups.delete(sourceGroup.id);
      const removed = new Set([...nodes.values()].filter((node) => node.sourceTemplateId === templateId && (node.stackId === sourceGroup.id || node.stackSetId === sourceGroup.id)).map((node) => node.id));
      removed.forEach((id) => nodes.delete(id));
      for (const [id, edge] of edges) if (removed.has(edge.source) || removed.has(edge.target)) edges.delete(id);
    }
  }
  let removedBoundary = true;
  while (removedBoundary) {
    removedBoundary = false;
    const referencedParents = new Set([...nodes.values()].flatMap((node) => node.physicalParentId ? [node.physicalParentId] : []));
    for (const id of supersededBoundaryIds) {
      if (nodes.has(id) && !referencedParents.has(id)) { nodes.delete(id); removedBoundary = true; }
    }
  }
  const resolvedNames = new Set([...groups.values()].filter((group) => group.kind === 'nested-stack' && !group.unresolvedTemplate).map((group) => group.name));
  const finalDiagnostics = diagnostics.filter((item) => item.code !== 'NESTED_TEMPLATE_UNRESOLVED' || ![...resolvedNames].some((name) => item.message.includes(name)));
  const deploymentGroups = [...groups.values()];
  const finalNodes = [...nodes.values()];
  const finalEdges = [...edges.values()];
  const resolutionOwnerIds = resolutions.map((resolution) => resolution.ownerId);
  const collisions = [...new Set(resolutionOwnerIds.filter((id, index) => resolutionOwnerIds.indexOf(id) !== index))];
  if (collisions.length) finalDiagnostics.push(associationDiagnostic('DEPLOYMENT_ID_COLLISION', 'Two template associations resolve to the same deployment identity.'));
  return {
    ...plan,
    id: stableId('resolved-import-plan', plan.id, JSON.stringify(resolutions), JSON.stringify(nestedResolutions)), deploymentGroups, nodes: finalNodes, edges: finalEdges, diagnostics: finalDiagnostics, collisions,
    placementResolutions: plan.placementResolutions.map((placement) => ({ ...placement, ...(nodes.get(placement.nodeId)?.physicalParentId ? { proposedParentId: nodes.get(placement.nodeId)?.physicalParentId } : {}) })),
    summary: { ...plan.summary, stackCount: deploymentGroups.filter((group) => group.kind === 'stack').length, stackSetCount: deploymentGroups.filter((group) => group.kind === 'stackset').length, relationshipCount: finalEdges.length, unresolvedReferenceCount: finalEdges.filter((edge) => edge.validationStatus === 'unresolved').length },
  };
}

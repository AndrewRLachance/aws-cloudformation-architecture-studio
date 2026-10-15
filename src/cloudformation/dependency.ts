/**
 * @file CloudFormation intrinsic dependency analysis.
 * @module cloudformation/dependency
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file scans template resources for Ref, Fn::GetAtt, Fn::Sub, Fn::ImportValue, and DependsOn relationships.
 */
import type { CloudFormationTemplateRecord, DiagramEdge, IntrinsicReference, JsonValue, RelationshipType } from '../domain/types';
import { stableId } from '../domain/ids';
import { expressionFingerprint, evaluateStaticExpression, isRecord } from './fidelity';

interface RelationshipRule { readonly id: string; readonly source: RegExp; readonly path: RegExp; readonly type: RelationshipType; readonly confidence: 'high' | 'medium'; }

/** Ordered, conservative semantic rules for commonly modeled AWS service families. */
const RELATIONSHIP_RULES: readonly RelationshipRule[] = [
  { id: 'network-route', source: /^AWS::(EC2::Route|EC2::RouteTable|EC2::TransitGateway|EC2::VPCEndpoint|NetworkManager::)/, path: /(RouteTable|Gateway|TransitGateway|VpcPeering|NetworkFunctionGroup|CoreNetwork)/i, type: 'routes-through', confidence: 'high' },
  { id: 'network-placement', source: /^AWS::(EC2|ECS|EKS|Lambda|RDS|ElastiCache|ElasticLoadBalancingV2)::/, path: /(VpcId|Subnet|NetworkConfiguration|VpcConfig)/i, type: 'associated-with', confidence: 'high' },
  { id: 'security-group', source: /^AWS::/, path: /(SecurityGroup|SourceSecurityGroup|GroupId|GroupIds)/i, type: 'associated-with', confidence: 'high' },
  { id: 'load-balancing', source: /^AWS::(ElasticLoadBalancingV2|ECS|ApiGatewayV2)::/, path: /(TargetGroup|LoadBalancer|Listener)/i, type: 'associated-with', confidence: 'high' },
  { id: 'iam-role', source: /^AWS::(Lambda|ECS|EKS|ApiGateway|ApiGatewayV2|StepFunctions|Events|Glue|CodeBuild|CodePipeline|Serverless)::/, path: /(Role|RoleArn|ExecutionRole|ServiceRole)/i, type: 'assumes-role', confidence: 'high' },
  { id: 'kms-encryption', source: /^AWS::/, path: /(KmsKey|KMSKey|KeyArn|MasterKey)/, type: 'associated-with', confidence: 'medium' },
  { id: 'event-publish', source: /^AWS::(Events|SNS|Lambda|Serverless|StepFunctions|Pipes)::/, path: /(Topic|TopicArn|EventBus|Destination|Target)/i, type: 'publishes-event', confidence: 'medium' },
  { id: 'event-subscribe', source: /^AWS::(SQS|SNS|Lambda|Serverless|Pipes|Kinesis|DynamoDB)::/, path: /(Queue|QueueArn|Subscription|EventSource|Stream)/i, type: 'subscribes-to-event', confidence: 'medium' },
  { id: 'data-write', source: /^AWS::(Glue|Firehose|Backup|DMS|DataPipeline|Serverless)::/, path: /(Target|Destination|Bucket|Table|Database|Cluster|Repository)/i, type: 'writes-to', confidence: 'medium' },
  { id: 'data-read', source: /^AWS::(Lambda|ECS|EKS|Athena|Glue|StepFunctions|Serverless)::/, path: /(Source|Origin|Bucket|Table|Database|Cluster|Repository|Secret|Parameter)/i, type: 'reads-from', confidence: 'medium' },
  { id: 'observability', source: /^AWS::(Logs|CloudWatch|XRay|ApplicationInsights)::/, path: /(LogGroup|Alarm|Dashboard|Resource|Trace)/i, type: 'associated-with', confidence: 'medium' },
  { id: 'edge-dns', source: /^AWS::(CloudFront|Route53|Route53Resolver|GlobalAccelerator)::/, path: /(Distribution|Origin|HostedZone|Resolver|Endpoint)/i, type: 'associated-with', confidence: 'medium' },
];

/** Infers a relationship type from a CloudFormation property path. */
function inferRelationship(resourceType: string, path: string, fallback: RelationshipType): { type: RelationshipType; rule?: RelationshipRule } {
  const rule = RELATIONSHIP_RULES.find((candidate) => candidate.source.test(resourceType) && candidate.path.test(path));
  return { type: rule?.type ?? fallback, ...(rule ? { rule } : {}) };
}

/** Extracts target logical ID and attribute from Fn::GetAtt syntax. */
function targetFromGetAtt(value: unknown): { target: string; attribute?: string } | undefined {
  if (typeof value === 'string') {
    const [target, ...rest] = value.split('.');
    if (!target) return undefined;
    return rest.length > 0 ? { target, attribute: rest.join('.') } : { target };
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return typeof value[1] === 'string' ? { target: value[0], attribute: value[1] } : { target: value[0] };
  }
  return undefined;
}

/** Extracts unresolved variable references from Fn::Sub syntax. */
function extractSubReferences(value: unknown): string[] {
  const template = typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
  const variableMap = Array.isArray(value) && isRecord(value[1]) ? new Set(Object.keys(value[1])) : new Set<string>();
  if (!template) return [];
  const results = new Set<string>();
  const regex = /\$\{([A-Za-z0-9:_-]+)(?:\.([A-Za-z0-9:_-]+))?\}/g;
  for (const match of template.matchAll(regex)) {
    const name = match[1];
    if (name && !name.startsWith('AWS::') && !variableMap.has(name)) results.add(name);
  }
  return [...results];
}

/** Finds CloudFormation intrinsic references and DependsOn relationships in a template. */
export function analyzeIntrinsicReferences(template: CloudFormationTemplateRecord): IntrinsicReference[] {
  const resources = Object.fromEntries(Object.entries(template.fidelity.projectedResources).map(([logicalId, projection]) => [logicalId, projection.resource]));
  const logicalIds = new Set(Object.keys(resources));
  const references: IntrinsicReference[] = [];
  const visit = (sourceLogicalId: string, sourceType: string, value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(sourceLogicalId, sourceType, entry, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, entry] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      const inferred = inferRelationship(sourceType, childPath, 'references-resource');
      const extras = inferred.rule ? { inferenceRule: inferred.rule.id, inferenceConfidence: inferred.rule.confidence } as const : { inferenceConfidence: 'low' as const };
      if (key === 'Ref' && typeof entry === 'string') {
        references.push({ sourceLogicalId, target: entry, intrinsic: 'Ref', propertyPath: childPath, relationshipType: inferred.type, external: !logicalIds.has(entry), ...extras });
      } else if (key === 'Fn::GetAtt') {
        const target = targetFromGetAtt(entry);
        if (target) references.push({ sourceLogicalId, target: target.target, intrinsic: key, propertyPath: childPath, relationshipType: target.attribute?.startsWith('Outputs.') ? 'nested-stack' : inferred.type, external: !logicalIds.has(target.target), ...(target.attribute ? { attribute: target.attribute } : {}), ...extras });
      } else if (key === 'Fn::Sub') {
        for (const target of extractSubReferences(entry)) references.push({ sourceLogicalId, target, intrinsic: key, propertyPath: childPath, relationshipType: inferred.type, external: !logicalIds.has(target), ...extras });
      } else if (key === 'Fn::ImportValue') {
        const target = evaluateStaticExpression(entry, { parameters: Object.fromEntries(Object.entries(template.parameters).flatMap(([name, raw]) => isRecord(raw) && 'Default' in raw ? [[name, raw.Default]] : [])), mappings: template.mappings }) ?? expressionFingerprint(entry);
        references.push({ sourceLogicalId, target, targetExpression: entry, intrinsic: key, propertyPath: childPath, relationshipType: 'imports-cloudformation-output', external: true, inferenceRule: 'cloudformation-import-value', inferenceConfidence: 'high' });
      } else if (key === 'Fn::GetStackOutput') {
        references.push({ sourceLogicalId, target: expressionFingerprint(entry), targetExpression: entry, intrinsic: key, propertyPath: childPath, relationshipType: 'imports-cloudformation-output', external: true, inferenceRule: 'cloudformation-get-stack-output', inferenceConfidence: 'high' });
      }
      visit(sourceLogicalId, sourceType, entry, childPath);
    }
  };
  for (const [logicalId, rawResource] of Object.entries(resources)) {
    if (!isRecord(rawResource)) continue;
    const dependsOn = rawResource.DependsOn;
    const dependencies = typeof dependsOn === 'string' ? [dependsOn] : Array.isArray(dependsOn) ? dependsOn.filter((item): item is string => typeof item === 'string') : [];
    for (const target of dependencies) references.push({ sourceLogicalId: logicalId, target, intrinsic: 'DependsOn', propertyPath: `Resources.${logicalId}.DependsOn`, relationshipType: 'depends-on', external: !logicalIds.has(target) });
    const sourceType = typeof rawResource.Type === 'string' ? rawResource.Type : 'AWS::Unknown::Resource';
    visit(logicalId, sourceType, rawResource.Properties ?? {}, `Resources.${logicalId}.Properties`);
    if (typeof rawResource.Condition === 'string') references.push({ sourceLogicalId: logicalId, target: rawResource.Condition, intrinsic: 'Condition', propertyPath: `Resources.${logicalId}.Condition`, relationshipType: 'references-resource', external: true });
  }
  const fingerprints = new Set<string>();
  return references.filter((reference) => {
    const fingerprint = `${reference.sourceLogicalId}|${reference.target}|${reference.relationshipType}|${reference.propertyPath}`;
    if (fingerprints.has(fingerprint)) return false;
    fingerprints.add(fingerprint);
    return true;
  });
}

/** Converts discovered intrinsic references into persisted diagram edges. */
export function referencesToEdges(template: CloudFormationTemplateRecord, nodeIdByLogicalId: Readonly<Record<string, string>>, externalNodeId: (reference: IntrinsicReference) => string): DiagramEdge[] {
  return analyzeIntrinsicReferences(template).map((reference) => {
    const source = nodeIdByLogicalId[reference.sourceLogicalId];
    const target = nodeIdByLogicalId[reference.target] ?? externalNodeId(reference);
    const id = stableId('edge', template.id, reference.sourceLogicalId, reference.target, reference.relationshipType, reference.propertyPath);
    const metadata: Record<string, JsonValue> = {};
    if (reference.targetExpression !== undefined) metadata.targetExpression = reference.targetExpression as JsonValue;
    if (reference.inferenceRule) metadata.inferenceRule = reference.inferenceRule;
    if (reference.inferenceConfidence) metadata.inferenceConfidence = reference.inferenceConfidence;
    return {
      id,
      source: source ?? stableId('missing-source', reference.sourceLogicalId),
      target,
      relationshipType: reference.relationshipType,
      label: reference.intrinsic,
      direction: 'forward',
      metadata,
      sourcePropertyPath: reference.propertyPath,
      sourceTemplateId: template.id,
      validationStatus: reference.external ? 'unresolved' : 'valid',
    };
  });
}

/**
 * @file AWS resource node renderer.
 * @module ui/nodes/AwsResourceNode
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders resource nodes with service glyphs, CloudFormation type labels, badges, handles, and lock state.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ArchitectureFlowNode } from '../../reactflow/adapters';
import { NodeAnnotations } from './NodeAnnotations';

/** Short labels displayed inside AWS resource node icons. */
const SERVICE_CODES: Readonly<Record<string, string>> = {
  ec2: 'EC2', alb: 'ALB', nlb: 'NLB', ecs: 'ECS', eks: 'EKS', lambda: 'λ', 'lambda-layer': 'LYR', 'step-functions': 'SFN', appsync: 'GQL', 'serverless-application': 'APP', 'serverless-connector': 'CON', 'api-gateway': 'API', rds: 'RDS', dynamodb: 'DDB', s3: 'S3', sqs: 'SQS', sns: 'SNS', eventbridge: 'EVB', kinesis: 'KIN', elasticache: 'EC', 'secrets-manager': 'SEC', 'ssm-parameter': 'SSM', cloudfront: 'CF', route53: 'R53', 'iam-role': 'IAM', 'iam-policy': 'POL', 'security-group': 'SG', 'route-table': 'RT', 'nat-gateway': 'NAT', 'internet-gateway': 'IGW', 'vpc-endpoint': 'VPCE', 'vpc-peering': 'PCX', 'transit-gateway': 'TGW', 'nested-stack': 'NEST', 'cloudformation-generic': 'CFN',
};

/** Renders a React Flow node for an AWS resource. */
export function AwsResourceNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const node = data.domain;
  if (node.kind !== 'aws-resource') return null;
  return (
    <article className={`architecture-node resource-node service-${node.resourceType} ${selected ? 'is-selected' : ''}`} data-testid={`node-${node.id}`} aria-label={`${node.name}, ${node.cloudFormationType}`}>
      <div className="service-icon" aria-hidden="true">{SERVICE_CODES[node.resourceType]}</div>
      <div className="resource-copy">
        <span className="node-kicker">{node.resourceType.replaceAll('-', ' ')}</span>
        <strong>{node.name}</strong>
        <small>{node.cloudFormationType}</small>
      </div>
      {data.badges.length > 0 && <div className="node-badges">{data.badges.slice(0, 3).map((badge) => <span key={badge}>{badge}</span>)}</div>}
      <NodeAnnotations node={node} />
      {node.locked && <span className="lock-indicator" aria-label="Locked">▣</span>}
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="target" position={Position.Top} id="north" />
      <Handle type="source" position={Position.Bottom} id="south" />
    </article>
  );
}

/**
 * @file Searchable architecture palette.
 * @module ui/palette/Palette
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file lists draggable boundary, resource, control, deployment, logical, and external reference entries.
 */
import { useMemo, useState } from 'react';
import { PALETTE_MIME, type PalettePayload } from './types';
import { useDiagramStore } from '../../store/useDiagramStore';
import { BUILT_IN_PATTERNS, BUILT_IN_STARTERS, createPatternFromSelection, type ReusablePattern } from '../../templates/patterns';
import { LocalStoragePatternRepository } from '../../persistence/patternRepository';

const patternRepository = new LocalStoragePatternRepository();

/** Static palette entries available for manual diagram creation. */
const ITEMS: readonly PalettePayload[] = [
  { category: 'boundary', name: 'AWS Organization', boundaryType: 'organization' },
  { category: 'boundary', name: 'Organizational Unit', boundaryType: 'organizational-unit' },
  { category: 'boundary', name: 'AWS Account', boundaryType: 'account' },
  { category: 'boundary', name: 'Region', boundaryType: 'region' },
  { category: 'boundary', name: 'VPC', boundaryType: 'vpc' },
  { category: 'boundary', name: 'Availability Zone', boundaryType: 'availability-zone' },
  { category: 'boundary', name: 'Subnet', boundaryType: 'subnet' },
  { category: 'resource', name: 'EC2 Instance', resourceType: 'ec2', cloudFormationType: 'AWS::EC2::Instance' },
  { category: 'resource', name: 'Application Load Balancer', resourceType: 'alb', cloudFormationType: 'AWS::ElasticLoadBalancingV2::LoadBalancer' },
  { category: 'resource', name: 'Network Load Balancer', resourceType: 'nlb', cloudFormationType: 'AWS::ElasticLoadBalancingV2::LoadBalancer' },
  { category: 'resource', name: 'ECS Service', resourceType: 'ecs', cloudFormationType: 'AWS::ECS::Service' },
  { category: 'resource', name: 'EKS Cluster', resourceType: 'eks', cloudFormationType: 'AWS::EKS::Cluster' },
  { category: 'resource', name: 'Lambda Function', resourceType: 'lambda', cloudFormationType: 'AWS::Lambda::Function' },
  { category: 'resource', name: 'API Gateway', resourceType: 'api-gateway', cloudFormationType: 'AWS::ApiGatewayV2::Api' },
  { category: 'resource', name: 'RDS Database', resourceType: 'rds', cloudFormationType: 'AWS::RDS::DBInstance' },
  { category: 'resource', name: 'DynamoDB Table', resourceType: 'dynamodb', cloudFormationType: 'AWS::DynamoDB::Table' },
  { category: 'resource', name: 'S3 Bucket', resourceType: 's3', cloudFormationType: 'AWS::S3::Bucket' },
  { category: 'resource', name: 'SQS Queue', resourceType: 'sqs', cloudFormationType: 'AWS::SQS::Queue' },
  { category: 'resource', name: 'SNS Topic', resourceType: 'sns', cloudFormationType: 'AWS::SNS::Topic' },
  { category: 'resource', name: 'EventBridge Bus', resourceType: 'eventbridge', cloudFormationType: 'AWS::Events::EventBus' },
  { category: 'resource', name: 'Kinesis Stream', resourceType: 'kinesis', cloudFormationType: 'AWS::Kinesis::Stream' },
  { category: 'resource', name: 'ElastiCache Cluster', resourceType: 'elasticache', cloudFormationType: 'AWS::ElastiCache::CacheCluster' },
  { category: 'resource', name: 'Secrets Manager Secret', resourceType: 'secrets-manager', cloudFormationType: 'AWS::SecretsManager::Secret' },
  { category: 'resource', name: 'SSM Parameter', resourceType: 'ssm-parameter', cloudFormationType: 'AWS::SSM::Parameter' },
  { category: 'resource', name: 'CloudFront Distribution', resourceType: 'cloudfront', cloudFormationType: 'AWS::CloudFront::Distribution' },
  { category: 'resource', name: 'Route 53 Hosted Zone', resourceType: 'route53', cloudFormationType: 'AWS::Route53::HostedZone' },
  { category: 'resource', name: 'IAM Role', resourceType: 'iam-role', cloudFormationType: 'AWS::IAM::Role' },
  { category: 'resource', name: 'IAM Policy', resourceType: 'iam-policy', cloudFormationType: 'AWS::IAM::Policy' },
  { category: 'resource', name: 'Security Group', resourceType: 'security-group', cloudFormationType: 'AWS::EC2::SecurityGroup' },
  { category: 'resource', name: 'Route Table', resourceType: 'route-table', cloudFormationType: 'AWS::EC2::RouteTable' },
  { category: 'resource', name: 'NAT Gateway', resourceType: 'nat-gateway', cloudFormationType: 'AWS::EC2::NatGateway' },
  { category: 'resource', name: 'Internet Gateway', resourceType: 'internet-gateway', cloudFormationType: 'AWS::EC2::InternetGateway' },
  { category: 'resource', name: 'VPC Endpoint', resourceType: 'vpc-endpoint', cloudFormationType: 'AWS::EC2::VPCEndpoint' },
  { category: 'resource', name: 'VPC Peering', resourceType: 'vpc-peering', cloudFormationType: 'AWS::EC2::VPCPeeringConnection' },
  { category: 'resource', name: 'Transit Gateway', resourceType: 'transit-gateway', cloudFormationType: 'AWS::EC2::TransitGateway' },
  { category: 'resource', name: 'Nested Stack', resourceType: 'nested-stack', cloudFormationType: 'AWS::CloudFormation::Stack' },
  { category: 'control', name: 'Service Control Policy', controlType: 'service-control-policy' },
  { category: 'control', name: 'AWS Config Rule', controlType: 'config-rule' },
  { category: 'deployment', name: 'CloudFormation Stack', deploymentType: 'stack' },
  { category: 'deployment', name: 'CloudFormation StackSet', deploymentType: 'stackset' },
  { category: 'logical', name: 'Logical Group' },
  { category: 'external-reference', name: 'External Reference' },
  { category: 'text', name: 'Free-form text' },
  { category: 'legend', name: 'Architecture legend' },
];

/** Returns the palette section label for a payload category. */
function categoryLabel(category: PalettePayload['category']): string {
  return ({ boundary: 'Boundaries', resource: 'AWS resources', control: 'Security and governance', deployment: 'Deployment groups', logical: 'Logical groups', 'external-reference': 'External references', text: 'Diagram content', legend: 'Diagram content' })[category];
}

/** Props controlling palette collapse state and toggle behavior. */
export interface PaletteProps { readonly collapsed: boolean; readonly onToggle: () => void; }

/** Renders the searchable drag-and-drop architecture palette. */
export function Palette({ collapsed, onToggle }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [userPatterns, setUserPatterns] = useState<ReusablePattern[]>(() => patternRepository.load());
  const [targetStackId, setTargetStackId] = useState('');
  const document = useDiagramStore((state) => state.document); const selection = useDiagramStore((state) => state.selection); const insertPattern = useDiagramStore((state) => state.insertPattern); const replaceWithStarter = useDiagramStore((state) => state.replaceWithStarter);
  const filtered = useMemo(() => ITEMS.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [query]);
  const groups = useMemo(() => [...new Set(filtered.map((item) => item.category))], [filtered]);
  const startDrag = (event: React.DragEvent, item: PalettePayload): void => {
    event.dataTransfer.setData(PALETTE_MIME, JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'copy';
  };
  const origin = { x: (-document.viewport.x + 340) / document.viewport.zoom, y: (-document.viewport.y + 220) / document.viewport.zoom };
  const saveSelection = (): void => { const name = globalThis.prompt?.('Pattern name'); if (!name?.trim()) return; const pattern = createPatternFromSelection(document, selection.nodeIds, name); if (!pattern) return; const next = [...userPatterns, pattern]; patternRepository.save(next); setUserPatterns(next); };
  const replacePatterns = (patterns: ReusablePattern[]): void => { patternRepository.save(patterns); setUserPatterns(patterns); };
  return (
    <aside className={`palette ${collapsed ? 'is-collapsed' : ''}`} aria-label="Architecture palette">
      <div className="panel-heading">
        {!collapsed && <div><span className="eyebrow">Create</span><h2>Palette</h2></div>}
        <button type="button" className="icon-button" onClick={onToggle} aria-label={collapsed ? 'Expand palette' : 'Collapse palette'}>{collapsed ? '›' : '‹'}</button>
      </div>
      {!collapsed && <>
        <label className="search-field"><span className="sr-only">Search palette</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search AWS services" /></label>
        <div className="palette-list">
          {groups.map((category) => <section key={category} className="palette-group"><h3>{categoryLabel(category)}</h3>{filtered.filter((item) => item.category === category).map((item) => <button key={`${item.category}-${item.name}`} type="button" className="palette-item" draggable onDragStart={(event) => startDrag(event, item)} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(item)); }} aria-label={`Drag ${item.name} to canvas`}><span className={`palette-glyph glyph-${item.category}`} aria-hidden="true">{item.category === 'resource' ? 'AWS' : item.category.slice(0, 2).toUpperCase()}</span><span>{item.name}</span></button>)}</section>)}
          <section className="palette-group"><h3>Imported templates</h3><p className="palette-help">Imported resources appear here through the CloudFormation workflow.</p></section>
          <section className="palette-group template-catalog"><h3>Architecture starters</h3>{BUILT_IN_STARTERS.map((starter) => <button key={starter.id} type="button" className="palette-item" onClick={() => { if (document.nodeOrder.length === 0 || globalThis.confirm?.(`Replace this diagram with ${starter.name}?`)) replaceWithStarter(starter.id); }}><span className="palette-glyph">NEW</span><span><strong>{starter.name}</strong><small>{starter.description}</small></span></button>)}</section>
          <section className="palette-group template-catalog"><h3>AWS patterns</h3><label>Target stack<select value={targetStackId} onChange={(event) => setTargetStackId(event.target.value)}><option value="">Create a new stack</option>{document.deploymentGroupOrder.map((id) => document.deploymentGroupsById[id]).filter((group) => group?.kind === 'stack').map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>{BUILT_IN_PATTERNS.map((pattern) => <button key={pattern.id} type="button" className="palette-item" onClick={() => insertPattern(pattern, origin, targetStackId || undefined)}><span className="palette-glyph">AWS</span><span><strong>{pattern.name}</strong><small>{pattern.description}</small></span></button>)}</section>
          <section className="palette-group template-catalog"><h3>My patterns</h3><button type="button" onClick={saveSelection} disabled={selection.nodeIds.length === 0}>Save selection as pattern</button>{userPatterns.map((pattern) => <div key={pattern.id} className="saved-pattern"><button type="button" onClick={() => insertPattern(pattern, origin, targetStackId || undefined)}>{pattern.name}</button><button type="button" aria-label={`Rename ${pattern.name}`} onClick={() => { const name = globalThis.prompt?.('Pattern name', pattern.name); if (name?.trim()) replacePatterns(userPatterns.map((item) => item.id === pattern.id ? { ...item, name: name.trim() } : item)); }}>Rename</button><button type="button" aria-label={`Delete ${pattern.name}`} onClick={() => replacePatterns(userPatterns.filter((item) => item.id !== pattern.id))}>Delete</button></div>)}</section>
        </div>
      </>}
    </aside>
  );
}

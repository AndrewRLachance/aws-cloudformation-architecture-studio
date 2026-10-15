import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCloudFormationImportPlan } from '../src/cloudformation/importer';
import { createGenerationZip, generateCloudFormation } from '../src/cloudformation/generator';
import { createEmptyDocument } from '../src/domain/defaults';
import { createSeedDocument } from '../src/domain/seed';
import type { AwsResourceNode, DiagramDocument, DiagramEdge, StackDeploymentGroup } from '../src/domain/types';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

describe('CloudFormation generation', () => {
  it('generates one template per stack and a StackSet manifest without diagram-only resources', () => {
    const generated = generateCloudFormation(createSeedDocument());
    expect(generated.templates.filter((item) => item.ownerKind === 'stack')).toHaveLength(2);
    expect(generated.templates.filter((item) => item.ownerKind === 'stackset')).toHaveLength(1);
    expect((generated.stackInstanceManifest.instances as unknown[])).toHaveLength(2);
    const all = generated.templates.map((item) => item.json).join('\n');
    expect(all).not.toContain('physicalParentId');
    expect(all).not.toContain('position');
    expect(generated.manifest.schemaVersion).toBe(3);
    expect(generated.manifest.stackSets[0]?.targetGroups[0]?.organizationalUnitIds).toEqual(['ou-prod-12345678']);
    expect(generated.manifest.stackSets[0]?.operationPreferences?.regionOrder).toEqual(['us-east-1', 'us-west-2']);
    expect(generated.manifest.stackSets[0]?.permissionModel).toBe('SERVICE_MANAGED');
    expect(generated.manifest.nestedStacks).toEqual([]);
  });

  it('preserves unknown imported resources, conditions, metadata and policies through generation', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'raw-template.yaml', data: fixture('raw-template.yaml') }], { importType: 'single-stack', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const generic = plan.nodes.find((node) => node.kind === 'aws-resource' && node.resourceType === 'cloudformation-generic');
    const enrichedNodes = generic ? plan.nodes.map((node) => node.id === generic.id && node.kind === 'aws-resource' ? { ...node, condition: 'IsProd', metadata: { Owner: 'test' }, deletionPolicy: 'Retain', updateReplacePolicy: 'Retain' } : node) : plan.nodes;
    const base = createEmptyDocument();
    const document: DiagramDocument = { ...base, nodesById: Object.fromEntries(enrichedNodes.map((node) => [node.id, node])), nodeOrder: enrichedNodes.map((node) => node.id), edgesById: Object.fromEntries(plan.edges.map((edge) => [edge.id, edge])), edgeOrder: plan.edges.map((edge) => edge.id), deploymentGroupsById: Object.fromEntries(plan.deploymentGroups.map((group) => [group.id, { ...group, nodeIds: enrichedNodes.filter((node) => node.stackId === group.id).map((node) => node.id) }])), deploymentGroupOrder: plan.deploymentGroups.map((group) => group.id), templatesById: Object.fromEntries(plan.templates.map((template) => [template.id, template])), templateOrder: plan.templates.map((template) => template.id) };
    const generated = generateCloudFormation(document);
    const text = generated.templates[0]?.json ?? '';
    expect(text).toContain('Custom::Unknown');
    expect(text).toContain('Fn::ForEach::Buckets');
    expect(text).toContain('"Condition": "IsProd"');
    expect(text).toContain('"DeletionPolicy": "Retain"');
    expect(text).toContain('"UpdateReplacePolicy": "Retain"');
  });


  it('preserves imported VPC and subnet resources even though they render as physical boundaries', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'raw-template.yaml', data: fixture('raw-template.yaml') }], { importType: 'single-stack', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const base = createEmptyDocument();
    const document: DiagramDocument = {
      ...base,
      nodesById: Object.fromEntries(plan.nodes.map((node) => [node.id, node])),
      nodeOrder: plan.nodes.map((node) => node.id),
      edgesById: Object.fromEntries(plan.edges.map((edge) => [edge.id, edge])),
      edgeOrder: plan.edges.map((edge) => edge.id),
      deploymentGroupsById: Object.fromEntries(plan.deploymentGroups.map((group) => [group.id, group])),
      deploymentGroupOrder: plan.deploymentGroups.map((group) => group.id),
      templatesById: Object.fromEntries(plan.templates.map((template) => [template.id, template])),
      templateOrder: plan.templates.map((template) => template.id),
    };
    const generated = generateCloudFormation(document);
    const resources = generated.templates[0]?.ast.Resources as Record<string, Record<string, unknown>>;
    expect(resources.Vpc?.Type).toBe('AWS::EC2::VPC');
    expect(resources.Subnet?.Type).toBe('AWS::EC2::Subnet');
  });

  it('synthesizes Outputs and Fn::ImportValue for manual cross-stack relationships', () => {
    const base = createEmptyDocument();
    const common = {
      size: { width: 184, height: 78 },
      logicalGroupIds: [],
      attachedControlIds: [],
      securityGroupIds: [],
      locked: false,
      pinned: false,
      collapsed: false,
      zIndex: 10,
      userMetadata: {},
      diagramTags: {},
      annotations: [],
      importStatus: 'manual' as const,
    };
    const consumer: AwsResourceNode = {
      ...common,
      id: 'consumer',
      name: 'Consumer',
      kind: 'aws-resource',
      resourceType: 'lambda',
      cloudFormationType: 'AWS::Lambda::Function',
      properties: { Environment: { Variables: {} } },
      position: { x: 0, y: 0 },
      stackId: 'stack-consumer',
      sourceLogicalId: 'AppFunction',
      sourceResourceType: 'AWS::Lambda::Function',
    };
    const provider: AwsResourceNode = {
      ...common,
      id: 'provider',
      name: 'Provider',
      kind: 'aws-resource',
      resourceType: 's3',
      cloudFormationType: 'AWS::S3::Bucket',
      properties: {},
      position: { x: 250, y: 0 },
      stackId: 'stack-provider',
      sourceLogicalId: 'DataBucket',
      sourceResourceType: 'AWS::S3::Bucket',
    };
    const relationship: DiagramEdge = {
      id: 'edge-cross-stack',
      source: consumer.id,
      target: provider.id,
      relationshipType: 'references-resource',
      direction: 'forward',
      label: 'DataBucketName',
      sourcePropertyPath: 'Resources.AppFunction.Properties.Environment.Variables.BUCKET',
      metadata: {},
      validationStatus: 'valid',
    };
    const groups: StackDeploymentGroup[] = [
      { id: 'stack-consumer', name: 'consumer', kind: 'stack', nodeIds: [consumer.id], parameters: {}, outputs: {}, tags: {}, deploymentMetadata: [], metadata: {} },
      { id: 'stack-provider', name: 'provider', kind: 'stack', nodeIds: [provider.id], parameters: {}, outputs: {}, tags: {}, deploymentMetadata: [], metadata: {} },
    ];
    const document: DiagramDocument = {
      ...base,
      nodesById: { [consumer.id]: consumer, [provider.id]: provider },
      nodeOrder: [consumer.id, provider.id],
      edgesById: { [relationship.id]: relationship },
      edgeOrder: [relationship.id],
      deploymentGroupsById: Object.fromEntries(groups.map((group) => [group.id, group])),
      deploymentGroupOrder: groups.map((group) => group.id),
    };
    const generated = generateCloudFormation(document);
    const consumerAst = generated.templates.find((template) => template.ownerId === 'stack-consumer')?.ast;
    const providerAst = generated.templates.find((template) => template.ownerId === 'stack-provider')?.ast;
    expect(JSON.stringify(consumerAst)).toContain('Fn::ImportValue');
    expect(JSON.stringify(providerAst)).toContain('DataBucketName');
    expect(generated.warnings).toEqual([]);
  });


  it('emits JSON, YAML and a non-empty ZIP bundle', async () => {
    const document = createSeedDocument();
    const generated = generateCloudFormation(document);
    expect(generated.templates.every((item) => item.json.startsWith('{') && item.yaml.includes('Resources:'))).toBe(true);
    const zip = await createGenerationZip(document);
    expect(zip.size).toBeGreaterThan(500);
  });
});

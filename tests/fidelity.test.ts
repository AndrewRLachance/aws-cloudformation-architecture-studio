import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { compareCanonicalAsts, evaluateStaticExpression, expressionFingerprint } from '../src/cloudformation/fidelity';
import { analyzeIntrinsicReferences } from '../src/cloudformation/dependency';
import { GenerationValidationError, createGenerationZip, generateCloudFormation } from '../src/cloudformation/generator';
import { createCloudFormationImportPlan } from '../src/cloudformation/importer';
import { parseCloudFormationTemplate } from '../src/cloudformation/parser';
import { loadResourceSpecification, validateResourceProperties } from '../src/cloudformation/resourceSpec';
import { validateCloudFormationDocument, validateTemplateSemantics } from '../src/cloudformation/validation';
import { createEmptyDocument } from '../src/domain/defaults';
import type { CloudFormationImportPlan, DiagramDocument } from '../src/domain/types';
import { useDiagramStore } from '../src/store/useDiagramStore';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

function documentFromPlan(plan: CloudFormationImportPlan): DiagramDocument {
  const base = createEmptyDocument();
  return {
    ...base,
    nodesById: Object.fromEntries(plan.nodes.map((node) => [node.id, node])), nodeOrder: plan.nodes.map((node) => node.id),
    edgesById: Object.fromEntries(plan.edges.map((edge) => [edge.id, edge])), edgeOrder: plan.edges.map((edge) => edge.id),
    deploymentGroupsById: Object.fromEntries(plan.deploymentGroups.map((group) => [group.id, group])), deploymentGroupOrder: plan.deploymentGroups.map((group) => group.id),
    stackInstancesById: Object.fromEntries(plan.stackInstances.map((instance) => [instance.id, instance])), stackInstanceOrder: plan.stackInstances.map((instance) => instance.id),
    templatesById: Object.fromEntries(plan.templates.map((template) => [template.id, template])), templateOrder: plan.templates.map((template) => template.id),
    importSourcesById: { [plan.source.id]: plan.source }, importSourceOrder: [plan.source.id],
  };
}

beforeEach(() => useDiagramStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [], selection: { nodeIds: [], edgeIds: [] }, clipboard: { nodes: [], edges: [] }, validationIssues: [] }));

describe('CloudFormation fidelity milestone', () => {
  it('projects resolvable nested Fn::ForEach loops while preserving the authored loop exactly', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'foreach-template.yaml', data: fixture('foreach-template.yaml') }], { importType: 'single-stack', defaultAccountId: '111111111111', defaultRegion: 'us-east-1' });
    const template = plan.templates[0];
    expect(template?.fidelity.dialects).toContain('language-extensions');
    expect(template?.fidelity.transforms[0]).toMatchObject({ name: 'AWS::LanguageExtensions', path: 'Transform', executionOrder: 0, scope: 'top-level', support: 'partial' });
    expect(Object.keys(template?.fidelity.projectedResources ?? {})).toEqual(expect.arrayContaining(['AlphaBucket', 'BetaBucket', 'OneABucket', 'OneBBucket']));
    const projected = plan.nodes.filter((node) => node.sourceProjection);
    expect(projected).toHaveLength(4);
    expect(projected.every((node) => node.sourceProjection?.kind === 'foreach')).toBe(true);

    const generated = generateCloudFormation(documentFromPlan(plan));
    expect(generated.roundTripComparisons[0]?.status).toBe('exact');
    expect(generated.templates[0]?.ast.Resources).toHaveProperty('Fn::ForEach::Buckets');
    expect(generated.templates[0]?.ast.Resources).not.toHaveProperty('AlphaBucket');
    expect(generated.canExport).toBe(true);
  });

  it('preserves unresolved loops and blocks collisions without making import diagnostics blocking', async () => {
    const unresolved = await parseCloudFormationTemplate({ name: 'dynamic.yaml', text: 'Transform: AWS::LanguageExtensions\nParameters:\n  Names: { Type: CommaDelimitedList }\nResources:\n  Fn::ForEach::Items:\n    - Item\n    - !Ref Names\n    - ${Item}Bucket: { Type: AWS::S3::Bucket }\n' });
    expect(unresolved.record?.fidelity.confidence).toBe('partial');
    expect(unresolved.diagnostics.some((item) => item.code === 'FOREACH_COLLECTION_UNRESOLVED' && !item.blocking)).toBe(true);
    const collisionText = 'Transform: AWS::LanguageExtensions\nResources:\n  Fn::ForEach::Items:\n    - Item\n    - [Same, Same]\n    - ${Item}Bucket: { Type: AWS::S3::Bucket }\n';
    const plan = await createCloudFormationImportPlan([{ name: 'collision.yaml', data: collisionText }], { importType: 'single-stack' });
    expect(plan.diagnostics.some((item) => item.code === 'FOREACH_LOGICAL_ID_COLLISION' && !item.blocking)).toBe(true);
    expect(useDiagramStore.getState().commitImport(plan, 'merge')).toBe(true);
    expect(useDiagramStore.getState().validationIssues.some((item) => item.code === 'FOREACH_LOGICAL_ID_COLLISION' && item.severity === 'error')).toBe(true);
    expect(generateCloudFormation(useDiagramStore.getState().document).canExport).toBe(false);
    const macroPlan = await createCloudFormationImportPlan([{ name: 'macro.json', data: JSON.stringify({ Transform: ['Custom::First', 'AWS::LanguageExtensions'], Resources: { Bucket: { Type: 'AWS::S3::Bucket', Properties: { MetadataValue: { 'Fn::Transform': { Name: 'AWS::Include', Parameters: { Location: 'local-fragment' } } } } } } }) }], { importType: 'single-stack' });
    expect(macroPlan.templates[0]?.fidelity.transforms).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Custom::First', executionOrder: 0, scope: 'top-level', support: 'preserved' }),
      expect.objectContaining({ name: 'AWS::Include', scope: 'nested', support: 'preserved' }),
    ]));
    expect(generateCloudFormation(documentFromPlan(macroPlan)).roundTripComparisons[0]?.status).toBe('exact');
  });

  it('applies ordered relationship rules across the curated AWS service families', async () => {
    const resources = {
      Shared: { Type: 'AWS::S3::Bucket' },
      Route: { Type: 'AWS::EC2::Route', Properties: { RouteTableId: { Ref: 'Shared' } } },
      Service: { Type: 'AWS::ECS::Service', Properties: { LoadBalancers: [{ TargetGroupArn: { Ref: 'Shared' } }] } },
      Function: { Type: 'AWS::Lambda::Function', Properties: { Role: { Ref: 'Shared' }, SecretArn: { Ref: 'Shared' } } },
      Encrypted: { Type: 'AWS::S3::Bucket', Properties: { KmsMasterKeyId: { Ref: 'Shared' } } },
      Crawler: { Type: 'AWS::Glue::Crawler', Properties: { Targets: { S3Targets: [{ Path: { Ref: 'Shared' } }] } } },
      Filter: { Type: 'AWS::Logs::SubscriptionFilter', Properties: { LogGroupName: { Ref: 'Shared' } } },
      Distribution: { Type: 'AWS::CloudFront::Distribution', Properties: { Origins: [{ DomainName: { Ref: 'Shared' } }] } },
    };
    const parsed = await parseCloudFormationTemplate({ name: 'rules.json', text: JSON.stringify({ Resources: resources }) });
    const references = parsed.record ? analyzeIntrinsicReferences(parsed.record) : [];
    const bySourceAndPath = (source: string, path: string) => references.find((reference) => reference.sourceLogicalId === source && reference.propertyPath.includes(path));
    expect(bySourceAndPath('Route', 'RouteTableId')).toMatchObject({ relationshipType: 'routes-through', inferenceRule: 'network-route', inferenceConfidence: 'high' });
    expect(bySourceAndPath('Service', 'TargetGroupArn')).toMatchObject({ relationshipType: 'associated-with', inferenceRule: 'load-balancing' });
    expect(bySourceAndPath('Function', '.Role')).toMatchObject({ relationshipType: 'assumes-role', inferenceRule: 'iam-role' });
    expect(bySourceAndPath('Encrypted', 'KmsMasterKeyId')).toMatchObject({ relationshipType: 'associated-with', inferenceRule: 'kms-encryption' });
    expect(bySourceAndPath('Crawler', 'S3Targets')).toMatchObject({ relationshipType: 'writes-to', inferenceRule: 'data-write' });
    expect(bySourceAndPath('Filter', 'LogGroupName')).toMatchObject({ relationshipType: 'associated-with', inferenceRule: 'observability' });
    expect(bySourceAndPath('Function', 'SecretArn')).toMatchObject({ relationshipType: 'reads-from', inferenceRule: 'data-read' });
    expect(bySourceAndPath('Distribution', 'Origins')).toMatchObject({ relationshipType: 'associated-with', inferenceRule: 'edge-dns' });
  });

  it('models SAM resources and event-source relationships with the bundled offline SAM schema', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'sam-template.yaml', data: fixture('sam-template.yaml') }], { importType: 'single-stack' });
    expect(plan.templates, JSON.stringify(plan.diagnostics)).toHaveLength(1);
    expect(plan.templates[0]?.fidelity.dialects).toContain('sam');
    const handler = plan.nodes.find((node) => node.sourceLogicalId === 'Handler');
    expect(handler?.kind === 'aws-resource' ? handler.resourceType : undefined).toBe('lambda');
    expect(plan.edges.some((edge) => edge.relationshipType === 'subscribes-to-event' && edge.sourcePropertyPath?.includes('Events.QueueEvent.Properties.Queue'))).toBe(true);
    expect(['Workflow', 'Layer', 'Application', 'Connector', 'Graph'].every((logicalId) => { const node = plan.nodes.find((candidate) => candidate.sourceLogicalId === logicalId); return node?.kind === 'aws-resource' && node.resourceType !== 'cloudformation-generic'; })).toBe(true);
    const specification = await loadResourceSpecification();
    expect(validateResourceProperties(specification, 'AWS::Serverless::Function', { Runtime: 'nodejs22.x', Handler: 'index.handler', InlineCode: 'code' }).some((issue) => issue.code === 'UNKNOWN_RESOURCE_TYPE')).toBe(false);
    expect(generateCloudFormation(documentFromPlan(plan)).roundTripComparisons[0]?.status).toBe('exact');
  });

  it('reads a CDK cloud assembly without treating asset manifests or binary assets as templates', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ version: '40.0.0', artifacts: { SampleStack: { type: 'aws:cloudformation:stack', environment: 'aws://123456789012/us-west-2', properties: { templateFile: 'SampleStack.template.json' }, dependencies: ['SampleAssets'] }, SampleAssets: { type: 'cdk:asset-manifest', properties: { file: 'SampleStack.assets.json' } } } }));
    zip.file('SampleStack.template.json', fixture('cdk-template.json'));
    zip.file('SampleStack.assets.json', JSON.stringify({ version: '40.0.0', files: {} }));
    zip.file('asset.bin', new Uint8Array([0, 1, 2, 3]));
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const plan = await createCloudFormationImportPlan([{ name: 'cdk.out.zip', data }], { importType: 'stack-bundle' });
    expect(plan.templates, JSON.stringify(plan.diagnostics)).toHaveLength(1);
    expect(plan.source.cloudAssembly?.manifestVersion).toBe('40.0.0');
    expect(plan.source.cloudAssembly?.assetManifestFiles).toEqual(['SampleStack.assets.json']);
    expect(plan.deploymentGroups.find((group) => group.kind === 'stack')).toMatchObject({ name: 'SampleStack', accountId: '123456789012', region: 'us-west-2' });
    expect(plan.nodes.find((node) => node.sourceLogicalId === 'Bucket83908E77')?.cdkConstructPath).toBe('SampleStack/Bucket/Resource');
    expect(plan.nodes.find((node) => node.sourceLogicalId === 'CDKMetadata')?.cdkHelper).toBe(true);
    const generated = generateCloudFormation(documentFromPlan(plan));
    expect(generated.manifest.cloudAssemblies[0]?.stackArtifactIds).toEqual(['SampleStack']);
    expect(generated.roundTripComparisons[0]?.status).toBe('exact');
  });

  it('matches intrinsic export names by evaluated value and retains the authored expression', async () => {
    const provider = { Parameters: { Suffix: { Type: 'String', Default: 'shared' } }, Resources: { Bucket: { Type: 'AWS::S3::Bucket' } }, Outputs: { BucketName: { Value: { Ref: 'Bucket' }, Export: { Name: { 'Fn::Sub': '${AWS::StackName}-${Suffix}' } } } } };
    const consumer = { Resources: { Function: { Type: 'AWS::Lambda::Function', Properties: { Environment: { Variables: { BUCKET: { 'Fn::ImportValue': { 'Fn::Join': ['', ['network', '-', 'shared']] } } } } } } } };
    const manifest = { schemaVersion: 1, templates: [{ filename: 'provider.json', stackName: 'network', accountId: '111111111111', region: 'us-east-1' }, { filename: 'consumer.json', stackName: 'app', accountId: '111111111111', region: 'us-east-1' }] };
    const plan = await createCloudFormationImportPlan([{ name: 'provider.json', data: JSON.stringify(provider) }, { name: 'consumer.json', data: JSON.stringify(consumer) }, { name: 'import-manifest.json', data: JSON.stringify(manifest) }], { importType: 'multi-stack' });
    const edge = plan.edges.find((item) => item.relationshipType === 'imports-cloudformation-output');
    expect(edge?.validationStatus).toBe('valid');
    expect(plan.nodes.find((node) => node.id === edge?.target)?.sourceLogicalId).toBe('Bucket');
    expect(edge?.metadata.exportName).toEqual({ 'Fn::Sub': '${AWS::StackName}-${Suffix}' });
    expect(evaluateStaticExpression({ 'Fn::FindInMap': ['Names', 'Prod', 'Value'] }, { mappings: { Names: { Prod: { Value: 'resolved' } } } })).toBe('resolved');
    expect(evaluateStaticExpression({ 'Fn::Select': [1, ['first', 'second']] })).toBe('second');
    expect(evaluateStaticExpression({ 'Fn::If': ['Enabled', 'yes', 'no'] }, { conditions: { Enabled: true } })).toBe('yes');
    expect(evaluateStaticExpression({ 'Fn::Base64': 'value' })).toBe('base64:value');
    expect(expressionFingerprint({ 'Fn::GetAtt': 'Bucket.Arn' })).toBe(expressionFingerprint({ 'Fn::GetAtt': ['Bucket', 'Arn'] }));
  });

  it('associates v2 deployment metadata explicitly and emits fidelity reports and metadata files', async () => {
    const template = JSON.stringify({ Resources: { Bucket: { Type: 'AWS::S3::Bucket' } } });
    const manifest = { schemaVersion: 2, templates: [
      { filename: 'a.json', stackName: 'a', metadataFiles: [{ filename: 'a-policy.json', kind: 'stack-policy' }] },
      { filename: 'b.json', stackName: 'b', metadataFiles: [{ filename: 'b-policy.json', kind: 'stack-policy' }] },
    ] };
    const plan = await createCloudFormationImportPlan([
      { name: 'a.json', data: template }, { name: 'b.json', data: template }, { name: 'import-manifest.json', data: JSON.stringify(manifest) },
      { name: 'a-policy.json', data: JSON.stringify({ StackPolicyBody: '{"Statement":[]}' }) }, { name: 'b-policy.json', data: JSON.stringify({ StackPolicyBody: '{"Statement":[]}' }) },
    ], { importType: 'multi-stack' });
    const stacks = plan.deploymentGroups.filter((group) => group.kind === 'stack');
    expect(stacks.find((group) => group.name === 'a')?.deploymentMetadata[0]).toMatchObject({ originalFilename: 'a-policy.json', associationEvidence: 'manifest' });
    expect(stacks.find((group) => group.name === 'b')?.deploymentMetadata[0]?.originalFilename).toBe('b-policy.json');
    const document = documentFromPlan(plan);
    const generated = generateCloudFormation(document);
    expect(generated.manifest.validationReportFilename).toBe('validation-report.json');
    expect(generated.manifest.roundTripReportFilename).toBe('round-trip-report.json');
    expect(generated.manifest.deploymentMetadataFiles).toHaveLength(2);
    const archive = await JSZip.loadAsync(await (await createGenerationZip(document)).arrayBuffer());
    expect(archive.file('validation-report.json')).not.toBeNull();
    expect(archive.file('round-trip-report.json')).not.toBeNull();
    expect(Object.keys(archive.files).filter((name) => name.startsWith('deployment-metadata/') && name.endsWith('.json'))).toHaveLength(2);

    const stackId = 'arn:aws:cloudformation:us-east-1:111111111111:stack/application/abc';
    const allMetadata = await createCloudFormationImportPlan([
      { name: 'application.json', data: template },
      { name: 'describe-stacks.json', data: JSON.stringify({ Stacks: [{ StackId: stackId, StackName: 'application', EnableTerminationProtection: true, DriftInformation: { StackDriftStatus: 'DRIFTED' } }] }) },
      { name: 'stack-policy.json', data: JSON.stringify({ StackPolicyBody: '{"Statement":[]}' }) },
      { name: 'change-set.json', data: JSON.stringify({ StackId: stackId, StackName: 'application', ChangeSetName: 'review', Changes: [] }) },
      { name: 'resource-drifts.json', data: JSON.stringify({ StackResourceDrifts: [{ StackId: stackId, LogicalResourceId: 'Bucket', StackResourceDriftStatus: 'MODIFIED' }] }) },
    ], { importType: 'stack-bundle' });
    const metadataKinds = allMetadata.deploymentGroups.find((group) => group.kind === 'stack')?.deploymentMetadata.map((artifact) => artifact.kind);
    expect(metadataKinds).toEqual(expect.arrayContaining(['stack-policy', 'change-set', 'termination-protection', 'stack-drift', 'resource-drifts']));
  });

  it('commits semantically invalid templates for inspection and blocks CloudFormation ZIP export', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'invalid.json', data: JSON.stringify({ Resources: { 'Bad-Id': { Type: 'AWS::S3::Bucket' } } }) }], { importType: 'single-stack' });
    expect(plan.diagnostics.some((item) => item.blocking)).toBe(false);
    expect(useDiagramStore.getState().commitImport(plan, 'merge')).toBe(true);
    const document = useDiagramStore.getState().document;
    expect(useDiagramStore.getState().validationIssues.some((item) => item.code === 'INVALID_LOGICAL_ID')).toBe(true);
    expect(generateCloudFormation(document).canExport).toBe(false);
    await expect(createGenerationZip(document)).rejects.toBeInstanceOf(GenerationValidationError);
  });

  it('detects quotas and both resource and resolved stack dependency cycles', async () => {
    const oversized = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`R${index}`, { Type: 'AWS::S3::Bucket' }]));
    const parsed = await parseCloudFormationTemplate({ name: 'limits.json', text: JSON.stringify({ Resources: oversized }) });
    expect(parsed.record && validateTemplateSemantics(parsed.record).some((item) => item.code === 'STACK_LIMIT_RESOURCES')).toBe(true);

    const stackA = { Resources: { A: { Type: 'AWS::S3::Bucket', Properties: { Tags: [{ Key: 'other', Value: { 'Fn::ImportValue': 'BExport' } }] } } }, Outputs: { AOut: { Value: { Ref: 'A' }, Export: { Name: 'AExport' } } } };
    const stackB = { Resources: { B: { Type: 'AWS::S3::Bucket', Properties: { Tags: [{ Key: 'other', Value: { 'Fn::ImportValue': 'AExport' } }] } } }, Outputs: { BOut: { Value: { Ref: 'B' }, Export: { Name: 'BExport' } } } };
    const manifest = { schemaVersion: 1, templates: [{ filename: 'a.json', stackName: 'a', accountId: '1', region: 'us-east-1' }, { filename: 'b.json', stackName: 'b', accountId: '1', region: 'us-east-1' }] };
    const plan = await createCloudFormationImportPlan([{ name: 'a.json', data: JSON.stringify(stackA) }, { name: 'b.json', data: JSON.stringify(stackB) }, { name: 'import-manifest.json', data: JSON.stringify(manifest) }], { importType: 'multi-stack' });
    const issues = validateCloudFormationDocument(documentFromPlan(plan));
    expect(issues.filter((item) => item.code === 'CYCLIC_STACK_DEPENDENCY')).toHaveLength(2);
  });

  it('keeps analysis-only projections read-only and canonical comparison preserves array semantics', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'foreach-template.yaml', data: fixture('foreach-template.yaml') }], { importType: 'single-stack' });
    expect(useDiagramStore.getState().commitImport(plan, 'merge')).toBe(true);
    const projection = Object.values(useDiagramStore.getState().document.nodesById).find((node) => node.sourceProjection);
    expect(projection).toBeDefined();
    const beforeRevision = useDiagramStore.getState().document.revision.number;
    useDiagramStore.getState().updateNode(projection?.id ?? '', { properties: { Changed: true } } as never);
    expect(useDiagramStore.getState().document.revision.number).toBe(beforeRevision);
    useDiagramStore.getState().select([projection?.id ?? '']);
    useDiagramStore.getState().deleteSelection();
    expect(useDiagramStore.getState().document.nodesById[projection?.id ?? '']).toBeDefined();
    expect(compareCanonicalAsts('template', 'test.json', { A: { 'Fn::GetAtt': 'Bucket.Arn' }, Values: [1, 2] }, { Values: [1, 2], A: { 'Fn::GetAtt': ['Bucket', 'Arn'] } }, []).status).toBe('exact');
    expect(compareCanonicalAsts('template', 'test.json', { Values: [1, 2] }, { Values: [2, 1] }, []).status).toBe('unexpected-differences');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeCloudFormationImport, buildCloudFormationImportPlanFromAnalysis } from '../src/cloudformation/importer';
import { generateCloudFormation } from '../src/cloudformation/generator';
import { loadResourceSpecification, validateResourceProperties } from '../src/cloudformation/resourceSpec';
import { validateStackSetTargets } from '../src/cloudformation/stackset';
import { calculatePdfTiles } from '../src/export/diagramExport';
import { createEmptyDocument } from '../src/domain/defaults';
import type { DiagramDocument, DiagramExportOptions, ImportAssociationResolution, NestedAssociationResolution } from '../src/domain/types';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

function confirmedOwners(analysis: Awaited<ReturnType<typeof analyzeCloudFormationImport>>): ImportAssociationResolution[] {
  return analysis.templates.flatMap((template) => {
    const candidate = analysis.associationCandidates.find((item) => item.templateId === template.id);
    return candidate ? [{ templateId: template.id, candidateId: candidate.id, ownerKind: candidate.ownerKind, ownerId: candidate.ownerId, name: candidate.name, accountId: candidate.accountId, region: candidate.region, confirmed: true }] : [];
  });
}

function documentFromPlan(plan: ReturnType<typeof buildCloudFormationImportPlanFromAnalysis>): DiagramDocument {
  const base = createEmptyDocument();
  return {
    ...base,
    nodesById: Object.fromEntries(plan.nodes.map((node) => [node.id, node])), nodeOrder: plan.nodes.map((node) => node.id),
    edgesById: Object.fromEntries(plan.edges.map((edge) => [edge.id, edge])), edgeOrder: plan.edges.map((edge) => edge.id),
    deploymentGroupsById: Object.fromEntries(plan.deploymentGroups.map((group) => [group.id, group])), deploymentGroupOrder: plan.deploymentGroups.map((group) => group.id),
    stackInstancesById: Object.fromEntries(plan.stackInstances.map((instance) => [instance.id, instance])), stackInstanceOrder: plan.stackInstances.map((instance) => instance.id),
    templatesById: Object.fromEntries(plan.templates.map((template) => [template.id, template])), templateOrder: plan.templates.map((template) => template.id),
  };
}

describe('P1 product improvements', () => {
  it('loads the pinned full AWS specification lazily and validates required fields, types and intrinsics', async () => {
    const specification = await loadResourceSpecification();
    expect(specification.ResourceSpecificationVersion).toMatch(/^\d+\./);
    expect(Object.keys(specification.ResourceTypes).length).toBeGreaterThan(500);
    const missing = validateResourceProperties(specification, 'AWS::Lambda::Function', {});
    expect(missing.some((issue) => issue.code === 'REQUIRED_PROPERTY' && issue.path.endsWith('.Code'))).toBe(true);
    const intrinsic = validateResourceProperties(specification, 'AWS::Lambda::Function', { Code: { ZipFile: 'ok' }, Role: { Ref: 'RoleArn' }, Timeout: { Ref: 'Timeout' } });
    expect(intrinsic.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(validateResourceProperties(specification, 'Custom::Widget', { Anything: true })[0]?.severity).toBe('warning');
  });

  it('requires and then applies explicit nested association confirmation without reparsing', async () => {
    const analysis = await analyzeCloudFormationImport([
      { name: 'nested-parent.yaml', data: fixture('nested-parent.yaml') },
      { name: 'nested-child.yaml', data: fixture('nested-child.yaml') },
      { name: 'nested-import-manifest.json', data: fixture('nested-import-manifest.json') },
    ], { importType: 'multi-stack' });
    const nestedCandidate = analysis.nestedAssociationCandidates.find((candidate) => candidate.score >= 80);
    expect(nestedCandidate).toBeDefined();
    const unresolved = buildCloudFormationImportPlanFromAnalysis(analysis, confirmedOwners(analysis), [{ parentTemplateId: nestedCandidate!.parentTemplateId, parentLogicalId: nestedCandidate!.parentLogicalId, disposition: 'leave-unresolved', confirmed: false }]);
    expect(unresolved.diagnostics.some((item) => item.code === 'NESTED_ASSOCIATION_CONFIRMATION_REQUIRED' && item.blocking)).toBe(true);
    const resolution: NestedAssociationResolution = { parentTemplateId: nestedCandidate!.parentTemplateId, parentLogicalId: nestedCandidate!.parentLogicalId, childTemplateId: nestedCandidate!.childTemplateId, disposition: 'associate', confirmed: true };
    const resolved = buildCloudFormationImportPlanFromAnalysis(analysis, confirmedOwners(analysis), [resolution]);
    const nested = resolved.deploymentGroups.find((group) => group.kind === 'nested-stack');
    expect(nested?.kind === 'nested-stack' && nested.associationConfirmed && !nested.unresolvedTemplate).toBe(true);
    expect(resolved.diagnostics.some((item) => item.code === 'NESTED_TEMPLATE_UNRESOLVED')).toBe(false);
    const generated = generateCloudFormation(documentFromPlan(resolved));
    expect(generated.templates.some((template) => template.ownerKind === 'nested-stack')).toBe(true);
    expect(generated.manifest.nestedStacks[0]).toMatchObject({ parentLogicalId: 'ChildApplication', unresolvedTemplate: false, associationConfirmed: true });
  });

  it('blocks low-confidence and colliding top-level associations', async () => {
    const source = `Resources:\n  Bucket:\n    Type: AWS::S3::Bucket\n`;
    const analysis = await analyzeCloudFormationImport([{ name: 'one.yaml', data: source }, { name: 'two.yaml', data: source.replace('Bucket', 'OtherBucket') }], { importType: 'multi-stack' });
    expect(analysis.requiresAssociationConfirmation).toHaveLength(2);
    const unconfirmed = confirmedOwners(analysis).map((resolution, index) => ({ ...resolution, confirmed: index !== 0 }));
    expect(buildCloudFormationImportPlanFromAnalysis(analysis, unconfirmed, []).diagnostics.some((item) => item.code === 'ASSOCIATION_CONFIRMATION_REQUIRED' && item.blocking)).toBe(true);
    const colliding = confirmedOwners(analysis).map((resolution) => ({ ...resolution, ownerId: 'same-owner' }));
    const plan = buildCloudFormationImportPlanFromAnalysis(analysis, colliding, []);
    expect(plan.collisions).toEqual(['same-owner']);
    expect(plan.diagnostics.some((item) => item.code === 'DEPLOYMENT_ID_COLLISION' && item.blocking)).toBe(true);
  });

  it('keeps a confirmed unresolved nested child visible and nonblocking', async () => {
    const analysis = await analyzeCloudFormationImport([
      { name: 'nested-parent.yaml', data: fixture('nested-parent.yaml') },
      { name: 'nested-child.yaml', data: fixture('nested-child.yaml') },
      { name: 'nested-import-manifest.json', data: fixture('nested-import-manifest.json') },
    ], { importType: 'multi-stack' });
    const candidate = analysis.nestedAssociationCandidates[0];
    expect(candidate).toBeDefined();
    const plan = buildCloudFormationImportPlanFromAnalysis(analysis, confirmedOwners(analysis), [{ parentTemplateId: candidate!.parentTemplateId, parentLogicalId: candidate!.parentLogicalId, disposition: 'leave-unresolved', confirmed: true }]);
    const nested = plan.deploymentGroups.find((group) => group.kind === 'nested-stack');
    expect(nested?.kind === 'nested-stack' && nested.associationConfirmed && nested.unresolvedTemplate).toBe(true);
    expect(plan.diagnostics.filter((item) => item.blocking)).toEqual([]);
    expect(plan.nodes.some((node) => node.kind === 'external-reference' && node.referenceType === 'template-url' && !node.resolved)).toBe(true);
  });

  it('allows the same child template to back multiple confirmed nested deployments', async () => {
    const parent = `AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  ChildA:\n    Type: AWS::CloudFormation::Stack\n    Properties:\n      TemplateURL: child.yaml\n  ChildB:\n    Type: AWS::CloudFormation::Stack\n    Properties:\n      TemplateURL: child.yaml\n`;
    const child = `AWSTemplateFormatVersion: '2010-09-09'\nResources:\n  Bucket:\n    Type: AWS::S3::Bucket\n`;
    const analysis = await analyzeCloudFormationImport([{ name: 'parent.yaml', data: parent }, { name: 'child.yaml', data: child }], { importType: 'multi-stack', defaultAccountId: '111111111111', defaultRegion: 'us-east-1' });
    const nested: NestedAssociationResolution[] = analysis.nestedAssociationCandidates.filter((candidate) => candidate.score >= 80).map((candidate) => ({ parentTemplateId: candidate.parentTemplateId, parentLogicalId: candidate.parentLogicalId, childTemplateId: candidate.childTemplateId, disposition: 'associate', confirmed: true }));
    expect(nested).toHaveLength(2);
    const plan = buildCloudFormationImportPlanFromAnalysis(analysis, confirmedOwners(analysis), nested);
    const groups = plan.deploymentGroups.filter((group) => group.kind === 'nested-stack');
    expect(groups).toHaveLength(2);
    expect(new Set(groups.flatMap((group) => group.nodeIds)).size).toBe(groups.reduce((count, group) => count + group.nodeIds.length, 0));
  });

  it('ranks nested children from AWS ParentId, RootId and physical resource metadata without positional matching', async () => {
    const parentArn = 'arn:aws:cloudformation:us-east-1:111111111111:stack/parent-stack/parent-id';
    const childArn = 'arn:aws:cloudformation:us-east-1:111111111111:stack/mystery/child-id';
    const parent = `Resources:\n  ChildDeployment:\n    Type: AWS::CloudFormation::Stack\n    Properties:\n      TemplateURL: https://example.invalid/not-a-filename.yaml\n`;
    const child = `Resources:\n  Topic:\n    Type: AWS::SNS::Topic\n`;
    const describe = JSON.stringify({ Stacks: [
      { StackId: parentArn, StackName: 'parent-stack', RootId: parentArn },
      { StackId: childArn, StackName: 'mystery', ParentId: parentArn, RootId: parentArn },
    ] });
    const resources = JSON.stringify({ StackId: parentArn, StackResourceSummaries: [{ LogicalResourceId: 'ChildDeployment', PhysicalResourceId: childArn }] });
    const analysis = await analyzeCloudFormationImport([{ name: 'mystery.yaml', data: child }, { name: 'parent-stack.yaml', data: parent }, { name: 'describe-stacks.json', data: describe }, { name: 'list-stack-resources.json', data: resources }], { importType: 'multi-stack' });
    const candidate = analysis.nestedAssociationCandidates.find((item) => analysis.templates.find((template) => template.id === item.childTemplateId)?.originalFilename === 'mystery.yaml');
    expect(candidate?.score).toBeGreaterThanOrEqual(100);
    expect(candidate?.evidence.some((item) => item.includes('ParentId'))).toBe(true);
  });

  it('validates StackSet target permission rules and count/percentage preferences', () => {
    const issues = validateStackSetTargets('SERVICE_MANAGED', [{ id: 'target', accounts: ['bad'], organizationalUnitIds: [], regions: [], parameterOverrides: {} }], { failureToleranceCount: 0, failureTolerancePercentage: 10, maxConcurrentCount: 3 });
    expect(issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['targetGroups[0].accounts[0]', 'targetGroups[0].organizationalUnitIds', 'targetGroups[0].regions', 'operationPreferences']));
    expect(validateStackSetTargets('SELF_MANAGED', [{ id: 'target', accounts: ['111111111111'], organizationalUnitIds: [], regions: ['us-east-1'], parameterOverrides: {} }], { concurrencyMode: 'SOFT_FAILURE_TOLERANCE', failureToleranceCount: 0, maxConcurrentCount: 10 })).toEqual([]);
    expect(validateStackSetTargets('SERVICE_MANAGED', [{ id: 'target', accounts: [], organizationalUnitIds: ['ou-abcd-12345678'], regions: ['us-east-1'], parameterOverrides: {} }], { regionOrder: ['us-west-2'] }).some((issue) => issue.path === 'operationPreferences.regionOrder[0]')).toBe(true);
  });

  it('calculates deterministic row-major PDF tiling with overlap', () => {
    const options: DiagramExportOptions = { format: 'pdf', scope: 'full-diagram', scale: 2, transparent: false, backgroundColor: '#fff', padding: 32, pageSize: 'letter', orientation: 'landscape', tileOverlapInches: 0.25 };
    const tiles = calculatePdfTiles(2400, 1600, options);
    expect(tiles.columns).toBeGreaterThan(1);
    expect(tiles.rows).toBeGreaterThan(1);
    expect(tiles.stepX).toBeLessThan(tiles.contentWidthPixels);
    expect(tiles.stepY).toBeLessThan(tiles.contentHeightPixels);
  });
});

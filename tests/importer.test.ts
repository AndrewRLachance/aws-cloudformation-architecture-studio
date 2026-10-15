import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCloudFormationImportPlan, type ImportFile } from '../src/cloudformation/importer';
import { createEmptyDocument } from '../src/domain/defaults';
import { useDiagramStore } from '../src/store/useDiagramStore';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

beforeEach(() => {
  useDiagramStore.setState({ document: createEmptyDocument(), undoStack: [], redoStack: [], selection: { nodeIds: [], edgeIds: [] }, importPreview: undefined });
});

describe('CloudFormation import planning', () => {
  it('plans a single stack with resources, external references and inferred relationships', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'raw-template.yaml', data: fixture('raw-template.yaml') }], { importType: 'single-stack', defaultAccountId: '222222222222', defaultRegion: 'us-east-1' });
    expect(plan.summary.stackCount).toBe(1);
    expect(plan.summary.resourceCount).toBe(6);
    expect(plan.nodes.some((node) => node.kind === 'aws-resource' && node.resourceType === 'cloudformation-generic')).toBe(true);
    expect(plan.edges.some((edge) => edge.relationshipType === 'imports-cloudformation-output')).toBe(true);
    expect(plan.nodes.some((node) => node.kind === 'external-reference')).toBe(true);
    expect(plan.placementResolutions.length).toBeGreaterThan(0);
  });

  it('enriches stack identity from describe-stacks metadata', async () => {
    const plan = await createCloudFormationImportPlan([
      { name: 'raw-template.json', data: fixture('raw-template.json') },
      { name: 'describe-stacks.json', data: fixture('describe-stacks.json') },
    ], { importType: 'stack-bundle' });
    const stack = plan.deploymentGroups.find((group) => group.kind === 'stack');
    expect(stack?.name).toBe('app');
    expect(stack?.kind === 'stack' && stack.accountId).toBe('222222222222');
    expect(stack?.kind === 'stack' && stack.region).toBe('us-east-1');
  });

  it('imports multi-stack ZIP archives with a versioned manifest', async () => {
    const zip = new JSZip();
    zip.file('network.yaml', fixture('network.yaml'));
    zip.file('app.yaml', fixture('app.yaml'));
    zip.file('import-manifest.json', fixture('import-manifest.json'));
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const plan = await createCloudFormationImportPlan([{ name: 'multi-stack.zip', data }], { importType: 'multi-stack' });
    expect(plan.summary.stackCount).toBe(2);
    expect(plan.templates).toHaveLength(2);
    expect(plan.deploymentGroups.map((group) => group.name)).toEqual(expect.arrayContaining(['network', 'app']));
  });


  it('resolves cross-stack exports to provider resources instead of discarding the relationship', async () => {
    const plan = await createCloudFormationImportPlan([
      { name: 'network.yaml', data: fixture('network.yaml') },
      { name: 'app.yaml', data: fixture('app.yaml') },
      { name: 'import-manifest.json', data: fixture('import-manifest.json') },
    ], { importType: 'multi-stack' });
    const edge = plan.edges.find((candidate) => candidate.relationshipType === 'imports-cloudformation-output');
    expect(edge?.validationStatus).toBe('error');
    expect(plan.diagnostics.some((item) => item.code === 'UNSUPPORTED_IMPORTVALUE_CONTEXT')).toBe(true);
    expect(plan.nodes.find((node) => node.id === edge?.target)?.sourceLogicalId).toBe('Vpc');
    expect(plan.nodes.some((node) => node.kind === 'external-reference' && node.referenceValue === 'SharedVpcId')).toBe(false);
  });

  it('represents unresolved nested stacks as deployment groups with visible TemplateURL relationships', async () => {
    const plan = await createCloudFormationImportPlan([
      { name: 'nested-parent.yaml', data: fixture('nested-parent.yaml') },
      { name: 'nested-child.yaml', data: fixture('nested-child.yaml') },
      { name: 'nested-import-manifest.json', data: fixture('nested-import-manifest.json') },
    ], { importType: 'multi-stack' });
    const nested = plan.deploymentGroups.find((group) => group.kind === 'nested-stack');
    expect(nested?.kind === 'nested-stack' && nested.unresolvedTemplate).toBe(true);
    expect(plan.edges.some((edge) => edge.relationshipType === 'nested-stack')).toBe(true);
    expect(plan.templates).toHaveLength(2);
  });

  it('creates a StackSet definition without instances and reports unresolved targets', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'baseline.yaml', data: fixture('network.yaml') }], { importType: 'stackset' });
    expect(plan.summary.stackSetCount).toBe(1);
    expect(plan.summary.instanceCount).toBe(0);
    expect(plan.diagnostics.some((item) => item.code === 'STACKSET_TARGETS_UNRESOLVED')).toBe(true);
  });

  it('combines paginated instance files and suppresses duplicate account/Region instances', async () => {
    const files: ImportFile[] = [
      { name: 'baseline.yaml', data: fixture('network.yaml') },
      { name: 'describe-stack-set.json', data: fixture('describe-stack-set.json') },
      { name: 'list-stack-instances-1.json', data: fixture('list-stack-instances-1.json') },
      { name: 'list-stack-instances-2.json', data: fixture('list-stack-instances-2.json') },
    ];
    const plan = await createCloudFormationImportPlan(files, { importType: 'stackset' });
    expect(plan.stackInstances).toHaveLength(3);
    expect(new Set(plan.stackInstances.map((item) => `${item.accountId}|${item.region}`)).size).toBe(3);
    expect(plan.nodes.some((node) => node.kind === 'boundary' && node.boundaryType === 'account' && node.accountId === '333333333333')).toBe(true);
  });

  it('never partially commits a plan with blocking diagnostics', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'malformed.yaml', data: fixture('malformed.yaml') }], { importType: 'single-stack' });
    const before = useDiagramStore.getState().document;
    expect(useDiagramStore.getState().commitImport(plan, 'merge')).toBe(false);
    expect(useDiagramStore.getState().document).toBe(before);
    expect(useDiagramStore.getState().undoStack).toHaveLength(0);
  });

  it('commits atomically, is undoable, and is idempotent for identical source content', async () => {
    const plan = await createCloudFormationImportPlan([{ name: 'raw-template.json', data: fixture('raw-template.json') }], { importType: 'single-stack' });
    expect(useDiagramStore.getState().commitImport(plan, 'merge')).toBe(true);
    const after = useDiagramStore.getState();
    expect(after.document.nodeOrder.length).toBeGreaterThan(0);
    expect(after.undoStack).toHaveLength(1);
    expect(useDiagramStore.getState().commitImport(plan, 'merge')).toBe(true);
    expect(useDiagramStore.getState().undoStack).toHaveLength(1);
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().document.nodeOrder).toHaveLength(0);
    useDiagramStore.getState().redo();
    expect(useDiagramStore.getState().document.nodeOrder.length).toBeGreaterThan(0);
  });
});

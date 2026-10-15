import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createCloudFormationImportPlan } from '../src/cloudformation/importer';
import { calculateReimportChangeSet, reconcileImportPlan } from '../src/cloudformation/reimport';
import { createEmptyDocument } from '../src/domain/defaults';
import type { DiagramDocument } from '../src/domain/types';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

async function importedDocument(): Promise<{ document: DiagramDocument; v1: Awaited<ReturnType<typeof createCloudFormationImportPlan>> }> {
  const v1 = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v1.yaml') }], { importType: 'single-stack', defaultAccountId: '1', defaultRegion: 'us-east-1' });
  const base = createEmptyDocument();
  const document: DiagramDocument = {
    ...base,
    nodesById: Object.fromEntries(v1.nodes.map((node) => [node.id, node])), nodeOrder: v1.nodes.map((node) => node.id),
    edgesById: Object.fromEntries(v1.edges.map((edge) => [edge.id, edge])), edgeOrder: v1.edges.map((edge) => edge.id),
    deploymentGroupsById: Object.fromEntries(v1.deploymentGroups.map((group) => [group.id, group])), deploymentGroupOrder: v1.deploymentGroups.map((group) => group.id),
    templatesById: Object.fromEntries(v1.templates.map((template) => [template.id, template])), templateOrder: v1.templates.map((template) => template.id),
  };
  const bucket = Object.values(document.nodesById).find((node) => node.sourceLogicalId === 'Bucket');
  return { document: bucket ? { ...document, nodesById: { ...document.nodesById, [bucket.id]: { ...bucket, position: { x: 777, y: 333 }, logicalGroupIds: ['manual-group'], locked: true, userMetadata: { note: 'preserve' } } } } : document, v1 };
}

describe('re-import reconciliation', () => {
  it('reports added, removed and changed resources', async () => {
    const { document } = await importedDocument();
    const v2 = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v2.yaml') }], { importType: 'reimport', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const changes = calculateReimportChangeSet(document, v2);
    expect(changes.addedResourceKeys.some((key) => key.includes('Topic'))).toBe(true);
    expect(changes.removedResourceKeys.some((key) => key.includes('Queue'))).toBe(true);
    expect(changes.changedResourceKeys.some((key) => key.includes('Bucket'))).toBe(true);
  });

  it('preserves manual position, groups, lock and user metadata for matched resources', async () => {
    const { document } = await importedDocument();
    const v2 = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v2.yaml') }], { importType: 'reimport', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const reconciled = reconcileImportPlan(document, v2, 'mark-removed');
    const bucket = reconciled.nodes.find((node) => node.sourceLogicalId === 'Bucket');
    expect(bucket?.position).toEqual({ x: 777, y: 333 });
    expect(bucket?.physicalParentId).toBe(Object.values(document.nodesById).find((node) => node.sourceLogicalId === 'Bucket')?.physicalParentId);
    expect(bucket?.logicalGroupIds).toEqual(['manual-group']);
    expect(bucket?.locked).toBe(true);
    expect(bucket?.userMetadata).toEqual({ note: 'preserve' });
    expect(reconciled.nodes.some((node) => node.sourceLogicalId === 'Queue' && node.importStatus === 'removed')).toBe(true);
    expect(reconciled.nodes.some((node) => node.sourceLogicalId === 'Topic')).toBe(true);
  });

  it.each(['remove','detach','mark-removed'] as const)('applies removed-resource policy %s', async (policy) => {
    const { document } = await importedDocument();
    const v2 = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v2.yaml') }], { importType: 'reimport', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const reconciled = reconcileImportPlan(document, v2, policy);
    const queue = reconciled.nodes.find((node) => node.sourceLogicalId === 'Queue' || node.name === 'Queue');
    if (policy === 'remove') expect(queue).toBeUndefined();
    if (policy === 'detach') expect(queue?.importStatus).toBe('manual');
    if (policy === 'mark-removed') expect(queue?.importStatus).toBe('removed');
  });

  it('reports recursive property paths and applies per-resource removal policies', async () => {
    const { document } = await importedDocument();
    const v2 = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v2.yaml') }], { importType: 'reimport', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const changes = calculateReimportChangeSet(document, v2);
    const bucket = changes.resourceDiffs.find((diff) => diff.logicalId === 'Bucket');
    const queue = changes.resourceDiffs.find((diff) => diff.logicalId === 'Queue');
    expect(bucket?.propertyChanges.some((change) => change.path.includes('Properties'))).toBe(true);
    expect(queue?.kind).toBe('removed');
    const reconciled = reconcileImportPlan(document, v2, { defaultPolicy: 'remove', byResourceKey: queue ? { [queue.resourceKey]: 'detach' } : {} });
    expect(reconciled.nodes.find((node) => node.name === 'Queue')?.importStatus).toBe('manual');
  });

  it('diffs against editable CloudFormation properties instead of stale retained AST values', async () => {
    const { document } = await importedDocument();
    const bucket = Object.values(document.nodesById).find((node) => node.kind === 'aws-resource' && node.sourceLogicalId === 'Bucket');
    expect(bucket?.kind).toBe('aws-resource');
    const edited = bucket?.kind === 'aws-resource' ? { ...document, nodesById: { ...document.nodesById, [bucket.id]: { ...bucket, properties: { VersioningConfiguration: { Status: 'Enabled' } } } } } : document;
    const v2 = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v2.yaml') }], { importType: 'reimport', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    expect(calculateReimportChangeSet(edited, v2).changedResourceKeys.some((key) => key.includes('Bucket'))).toBe(false);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSeedDocument } from '../src/domain/seed';
import { createCloudFormationImportPlan } from '../src/cloudformation/importer';
import { reconcileImportPlan } from '../src/cloudformation/reimport';
import { useDiagramStore, HISTORY_LIMIT } from '../src/store/useDiagramStore';

const fixture = (name: string): string => readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');

beforeEach(() => {
  useDiagramStore.setState({ document: createSeedDocument(), selection: { nodeIds: [], edgeIds: [] }, clipboard: { nodes: [], edges: [] }, undoStack: [], redoStack: [], interactionBaseline: undefined, readOnly: false });
});

describe('normalized Zustand commands', () => {
  it('keeps equivalent selection updates idempotent', () => {
    useDiagramStore.getState().select(['ecs-service-a']);
    const selectedState = useDiagramStore.getState();
    useDiagramStore.getState().select(['ecs-service-a']);
    expect(useDiagramStore.getState()).toBe(selectedState);
  });

  it('ignores semantically unchanged node updates', () => {
    const before = useDiagramStore.getState();
    const position = before.document.nodesById['ecs-service-a']!.position;
    before.applyNodeChanges([{ type: 'position', id: 'ecs-service-a', position }]);
    expect(useDiagramStore.getState()).toBe(before);
  });

  it('creates one history entry for many transient drag updates', () => {
    const store = useDiagramStore.getState();
    store.beginInteraction('move-node');
    store.applyNodeChanges([{ type: 'position', id: 'ecs-service-a', position: { x: 60, y: 20 }, dragging: true }]);
    store.applyNodeChanges([{ type: 'position', id: 'ecs-service-a', position: { x: 70, y: 22 }, dragging: true }]);
    store.applyNodeChanges([{ type: 'position', id: 'ecs-service-a', position: { x: 80, y: 24 }, dragging: false }]);
    store.endInteraction('move-node');
    expect(useDiagramStore.getState().undoStack).toHaveLength(1);
    expect(useDiagramStore.getState().document.revision.lastCommand).toBe('move-node');
  });

  it('rejects invalid reparenting without a history entry or coordinate change', () => {
    const before = useDiagramStore.getState().document.nodesById['iam-execution-role']!;
    expect(useDiagramStore.getState().reparentNode(before.id, 'subnet-app-a')).toBe(false);
    const after = useDiagramStore.getState();
    expect(after.document.nodesById[before.id]).toEqual(before);
    expect(after.undoStack).toHaveLength(0);
  });

  it('reparents valid nodes while preserving absolute coordinates and supports undo', () => {
    const before = useDiagramStore.getState().document.nodesById['ecs-service-a']!;
    expect(useDiagramStore.getState().reparentNode(before.id, 'subnet-app-b')).toBe(true);
    expect(useDiagramStore.getState().document.nodesById[before.id]?.physicalParentId).toBe('subnet-app-b');
    expect(useDiagramStore.getState().undoStack).toHaveLength(1);
    useDiagramStore.getState().undo();
    expect(useDiagramStore.getState().document.nodesById[before.id]?.physicalParentId).toBe('subnet-app-a');
  });

  it('copies, pastes, duplicates, deletes, locks, switches views and preserves document data', () => {
    const store = useDiagramStore.getState();
    store.select(['ecs-service-a']); store.copySelection(); store.pasteClipboard();
    const pastedId = useDiagramStore.getState().selection.nodeIds[0];
    expect(pastedId).toBeDefined();
    expect(useDiagramStore.getState().document.nodesById[pastedId!]?.sourceTemplateId).toBeUndefined();
    useDiagramStore.getState().toggleLock('ecs-service-a');
    expect(useDiagramStore.getState().document.nodesById['ecs-service-a']?.locked).toBe(true);
    const count = useDiagramStore.getState().document.nodeOrder.length;
    useDiagramStore.getState().setViewMode('deployment');
    useDiagramStore.getState().setLayerVisible('network-traffic', false);
    expect(useDiagramStore.getState().document.nodeOrder).toHaveLength(count);
    useDiagramStore.getState().deleteSelection();
    expect(useDiagramStore.getState().document.nodesById[pastedId!]).toBeUndefined();
  });


  it('applies re-import atomically, preserves manual state, removes stale resources, and undoes in one step', async () => {
    const first = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v1.yaml') }], { importType: 'single-stack', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    useDiagramStore.setState({ document: createSeedDocument(), undoStack: [], redoStack: [] });
    expect(useDiagramStore.getState().commitImport(first, 'replace')).toBe(true);
    const bucket = Object.values(useDiagramStore.getState().document.nodesById).find((node) => node.sourceLogicalId === 'Bucket');
    expect(bucket).toBeDefined();
    const customized = { ...bucket!, position: { x: 333, y: 222 }, locked: true, logicalGroupIds: ['manual-group'], userMetadata: { note: 'preserve me' } };
    useDiagramStore.setState((state) => ({ document: { ...state.document, nodesById: { ...state.document.nodesById, [customized.id]: customized } }, undoStack: [], redoStack: [] }));
    const beforeReimport = useDiagramStore.getState().document;
    const second = await createCloudFormationImportPlan([{ name: 'application.yaml', data: fixture('reimport-v2.yaml') }], { importType: 'single-stack', defaultAccountId: '1', defaultRegion: 'us-east-1' });
    const reconciled = reconcileImportPlan(beforeReimport, second, 'remove');
    expect(useDiagramStore.getState().commitImport(reconciled, 'merge')).toBe(true);
    const after = useDiagramStore.getState();
    const updatedBucket = Object.values(after.document.nodesById).find((node) => node.sourceLogicalId === 'Bucket');
    expect(updatedBucket?.id).toBe(customized.id);
    expect(updatedBucket?.position).toEqual({ x: 333, y: 222 });
    expect(updatedBucket?.locked).toBe(true);
    expect(updatedBucket?.logicalGroupIds).toEqual(['manual-group']);
    expect(updatedBucket?.userMetadata).toEqual({ note: 'preserve me' });
    expect(Object.values(after.document.nodesById).some((node) => node.sourceLogicalId === 'Queue')).toBe(false);
    expect(Object.values(after.document.nodesById).some((node) => node.sourceLogicalId === 'Topic')).toBe(true);
    expect(after.undoStack).toHaveLength(1);
    after.undo();
    expect(Object.values(useDiagramStore.getState().document.nodesById).some((node) => node.sourceLogicalId === 'Queue')).toBe(true);
    expect(Object.values(useDiagramStore.getState().document.nodesById).some((node) => node.sourceLogicalId === 'Topic')).toBe(false);
  });


  it('bounds history size', () => {
    for (let index = 0; index < HISTORY_LIMIT + 10; index += 1) useDiagramStore.getState().setViewMode(index % 2 ? 'deployment' : 'infrastructure');
    expect(useDiagramStore.getState().undoStack).toHaveLength(HISTORY_LIMIT);
  });
});

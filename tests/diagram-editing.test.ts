import { beforeEach, describe, expect, it } from 'vitest';
import type { AwsResourceNode, BoundaryNode, DiagramDocument, SavedFilter } from '../src/domain/types';
import { createEmptyDocument } from '../src/domain/defaults';
import { alignSelection, distributeSelection, minimumBoundarySize, nudgeSelection, reorderNode } from '../src/domain/editing';
import { visibleNodeIds } from '../src/domain/filters';
import { BUILT_IN_PATTERNS, BUILT_IN_STARTERS, createPatternFromSelection, insertPattern } from '../src/templates/patterns';
import { useDiagramStore } from '../src/store/useDiagramStore';

function resource(id: string, x: number, y: number, parent?: string): AwsResourceNode {
  return { id, name: id, kind: 'aws-resource', resourceType: 's3', cloudFormationType: 'AWS::S3::Bucket', properties: {}, position: { x, y }, size: { width: 100, height: 50 }, ...(parent ? { physicalParentId: parent } : {}), logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 10, userMetadata: {}, diagramTags: {}, annotations: [], importStatus: 'manual' };
}
function withNodes(nodes: readonly (AwsResourceNode | BoundaryNode)[]): DiagramDocument { const base = createEmptyDocument(); return { ...base, nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])), nodeOrder: nodes.map((node) => node.id) }; }

describe('diagram editing geometry', () => {
  it('aligns and distributes unlocked siblings in one coordinate scope', () => {
    const document = withNodes([resource('a', 0, 20), resource('b', 200, 80), resource('c', 500, 30)]);
    const aligned = alignSelection(document, ['a','b','c'], 'top')!;
    expect(Object.values(aligned.nodesById).map((node) => node.position.y)).toEqual([20,20,20]);
    const distributed = distributeSelection(aligned, ['a','b','c'], 'horizontal')!;
    expect(distributed.nodesById.b?.position.x).toBe(250);
    expect(alignSelection(withNodes([{ ...resource('a', 0, 0), locked: true }, resource('b', 20, 0)]), ['a','b'], 'left')).toBeUndefined();
  });

  it('nudges only unlocked nodes and normalizes sibling z-order', () => {
    const document = withNodes([resource('a', 0, 0), { ...resource('b', 20, 0), locked: true }, { ...resource('c', 40, 0), zIndex: 20 }]);
    const moved = nudgeSelection(document, ['a','b'], { x: 8, y: -8 });
    expect(moved.nodesById.a?.position).toEqual({ x: 8, y: -8 }); expect(moved.nodesById.b?.position).toEqual({ x: 20, y: 0 });
    const reordered = reorderNode(document, 'a', 'front')!;
    expect(reordered.nodesById.a!.zIndex).toBe(2); expect(reordered.nodesById.c!.zIndex).toBe(1);
  });

  it('computes boundary minimums from descendant bounds and padding', () => {
    const boundary: BoundaryNode = { ...resource('boundary', 0, 0), kind: 'boundary', boundaryType: 'vpc', size: { width: 220, height: 140 } } as BoundaryNode;
    const document = withNodes([boundary, resource('child', 180, 100, boundary.id)]);
    expect(minimumBoundarySize(document, boundary.id)).toEqual({ width: 304, height: 174 });
  });
});

describe('saved filters and reusable patterns', () => {
  it('uses OR within facets, AND across facets, and retains ancestor boundaries', () => {
    const account: BoundaryNode = { ...resource('account', 0, 0), kind: 'boundary', boundaryType: 'account', accountId: '111111111111', size: { width: 400, height: 300 } } as BoundaryNode;
    const bucket = { ...resource('bucket', 20, 20, account.id), cloudFormationType: 'AWS::S3::Bucket' };
    const filter: SavedFilter = { id: 'filter', name: 'S3 in account', criteria: { accountIds: ['111111111111','222222222222'], regions: [], stackIds: [], stackSetIds: [], awsServices: ['S3'], validationStatuses: ['valid'] } };
    const base = withNodes([account, bucket]); const document = { ...base, savedFiltersById: { filter }, savedFilterOrder: ['filter'], activeFilterId: 'filter' };
    expect([...visibleNodeIds(document, [])]).toEqual(expect.arrayContaining(['account','bucket']));
  });

  it('ships the committed catalog and inserts repeated patterns without collisions', () => {
    expect(BUILT_IN_PATTERNS).toHaveLength(6); expect(BUILT_IN_STARTERS).toHaveLength(4);
    const first = insertPattern(createEmptyDocument(), BUILT_IN_PATTERNS[3]!, { x: 20, y: 30 });
    const second = insertPattern(first.document, BUILT_IN_PATTERNS[3]!, { x: 400, y: 30 });
    expect(new Set(second.document.nodeOrder).size).toBe(second.document.nodeOrder.length);
    const logicalIds = second.document.nodeOrder.map((id) => second.document.nodesById[id]?.sourceLogicalId).filter(Boolean);
    expect(new Set(logicalIds).size).toBe(logicalIds.length);
  });

  it('captures descendants and internal edges but not deployment ownership', () => {
    const pattern = BUILT_IN_PATTERNS[3]!; const inserted = insertPattern(createEmptyDocument(), pattern, { x: 0, y: 0 });
    const saved = createPatternFromSelection(inserted.document, inserted.nodeIds, 'Saved API')!;
    expect(saved.nodes).toHaveLength(pattern.nodes.length); expect(saved.edges).toHaveLength(pattern.edges.length);
  });
});

describe('editing store transactions', () => {
  beforeEach(() => useDiagramStore.setState({ document: withNodes([resource('a', 0, 0), resource('b', 200, 0)]), selection: { nodeIds: ['a','b'], edgeIds: [] }, undoStack: [], redoStack: [], readOnly: false }));
  it('persists preference and bulk diagram-tag changes as undoable commands', () => {
    useDiagramStore.getState().setGridSize(24); useDiagramStore.getState().setKeyboardMoveIncrement(4); useDiagramStore.getState().bulkSetDiagramTag('Owner', 'Platform');
    expect(useDiagramStore.getState().document.preferences).toMatchObject({ gridSize: 24, keyboardMoveIncrement: 4 });
    expect(useDiagramStore.getState().document.nodesById.a?.diagramTags.Owner).toBe('Platform');
    expect(useDiagramStore.getState().undoStack).toHaveLength(3);
  });

  it('adds, resolves, and deletes comments', () => {
    const now = new Date().toISOString(); useDiagramStore.getState().addComment({ id: 'comment', message: 'Review', target: { kind: 'node', nodeId: 'a', offset: { x: 0, y: 0 } }, resolved: false, createdAt: now, updatedAt: now });
    useDiagramStore.getState().updateComment('comment', { resolved: true }); expect(useDiagramStore.getState().document.commentsById.comment?.resolved).toBe(true);
    useDiagramStore.getState().deleteComment('comment'); expect(useDiagramStore.getState().document.commentsById.comment).toBeUndefined();
  });
});

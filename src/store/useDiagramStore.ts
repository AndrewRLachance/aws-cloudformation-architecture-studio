/**
 * @file Zustand diagram editor store.
 * @module store/useDiagramStore
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file owns document state, selection, undo/redo history, import commits, layout state, and editor commands.
 */
import { create } from 'zustand';
import type { EdgeChange, NodeChange, Viewport } from '@xyflow/react';
import type {
  CloudFormationImportPlan,
  DiagramDocument,
  DiagramEdge,
  DiagramNode,
  LayoutRequest,
  LayoutResult,
  LayerId,
  ValidationIssue,
  ViewMode,
  AwsResourceType,
  SelectionState,
  DeploymentGroup,
  InspectorTab,
  OperationProgress,
  DiagramComment,
  SavedFilter,
} from '../domain/types';
import { createEmptyDocument } from '../domain/defaults';
import { createSeedDocument } from '../domain/seed';
import { containmentPolicy } from '../domain/containment';
import { reparentPosition } from '../domain/coordinates';
import { uniqueId } from '../domain/ids';
import { validateReferentialIntegrity } from '../domain/schema';
import { validateStackSetTargets } from '../cloudformation/stackset';
import { validateCloudFormationDocument } from '../cloudformation/validation';
import { alignSelection as alignDocumentSelection, constrainBoundarySize, distributeSelection as distributeDocumentSelection, nudgeSelection as nudgeDocumentSelection, reorderNode, type Alignment, type Distribution } from '../domain/editing';
import { loadResourceSpecification } from '../cloudformation/resourceSpec';
import { createStarter, insertPattern, type ReusablePattern } from '../templates/patterns';

/** Maximum number of undo or redo document snapshots retained. */
const HISTORY_LIMIT = 50;
const validateDocument = (document: DiagramDocument): ValidationIssue[] => [...validateReferentialIntegrity(document), ...validateCloudFormationDocument(document)];

/** Document snapshot captured at the start of a drag or resize interaction. */
interface InteractionBaseline {
  readonly document: DiagramDocument;
  readonly label: string;
}
/** In-memory copied nodes and edges ready for paste operations. */
export interface ClipboardState {
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
}
/** Current automatic layout status and user-facing message. */
export interface LayoutState {
  readonly status: 'idle' | 'running' | 'error' | 'complete';
  readonly request?: LayoutRequest;
  readonly message?: string;
}
/** Current autosave status and last persisted revision. */
export interface AutosaveState {
  readonly status: 'idle' | 'saving' | 'saved' | 'error';
  readonly savedRevision: number;
  readonly message?: string;
}

/** Zustand state, selectors, and commands for the architecture editor. */
export interface DiagramStore {
  readonly document: DiagramDocument;
  readonly selection: SelectionState;
  readonly clipboard: ClipboardState;
  readonly undoStack: readonly DiagramDocument[];
  readonly redoStack: readonly DiagramDocument[];
  readonly interactionBaseline?: InteractionBaseline;
  readonly importPreview?: CloudFormationImportPlan;
  readonly layoutState: LayoutState;
  readonly validationIssues: readonly ValidationIssue[];
  readonly autosave: AutosaveState;
  readonly announcement: string;
  readonly readOnly: boolean;
  readonly inspectorTab: InspectorTab;
  readonly sourceNavigation?: Readonly<{ nodeId: string; path: string }>;
  readonly operationProgress?: OperationProgress;
  newDocument(): void;
  loadSeed(): void;
  loadDocument(document: DiagramDocument): void;
  select(nodeIds: readonly string[], edgeIds?: readonly string[]): void;
  clearSelection(): void;
  applyNodeChanges(changes: readonly NodeChange[]): void;
  applyEdgeChanges(changes: readonly EdgeChange[]): void;
  beginInteraction(label: string): void;
  endInteraction(label?: string): void;
  cancelInteraction(): void;
  addNode(node: DiagramNode): void;
  updateNode(nodeId: string, patch: Partial<DiagramNode>, command?: string): void;
  updateDeploymentGroup(groupId: string, patch: Partial<DeploymentGroup>, command?: string): void;
  addEdge(edge: DiagramEdge): void;
  updateEdge(edgeId: string, patch: Partial<DiagramEdge>, command?: string): void;
  deleteSelection(): void;
  copySelection(): void;
  pasteClipboard(): void;
  duplicateSelection(): void;
  reparentNode(nodeId: string, parentId?: string): boolean;
  detachNode(nodeId: string): boolean;
  toggleLock(nodeId: string): void;
  togglePin(nodeId: string): void;
  bringForward(nodeId: string): void;
  sendBackward(nodeId: string): void;
  bringToFront(nodeId: string): void;
  sendToBack(nodeId: string): void;
  alignSelection(alignment: Alignment): void;
  distributeSelection(direction: Distribution): void;
  nudgeSelection(delta: { x: number; y: number }): void;
  setGridSize(size: number): void;
  setKeyboardMoveIncrement(size: number): void;
  addComment(comment: DiagramComment): void;
  updateComment(commentId: string, patch: Partial<DiagramComment>): void;
  deleteComment(commentId: string): void;
  saveFilter(filter: SavedFilter): void;
  deleteFilter(filterId: string): void;
  setActiveFilter(filterId?: string): void;
  bulkSetStack(stackId?: string): void;
  bulkUpdateMembership(field: 'logicalGroupIds' | 'attachedControlIds' | 'securityGroupIds', ids: readonly string[], operation: 'add' | 'remove' | 'replace'): void;
  bulkSetDiagramTag(key: string, value?: string): void;
  bulkSetCloudFormationTag(key: string, value?: string): Promise<void>;
  insertPattern(pattern: ReusablePattern, origin: { x: number; y: number }, targetStackId?: string): void;
  replaceWithStarter(starterId: string): void;
  setViewMode(mode: ViewMode): void;
  setLayerVisible(layer: LayerId, visible: boolean): void;
  setViewport(viewport: Viewport): void;
  toggleSnap(): void;
  setReadOnly(value: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  openSource(nodeId: string, path?: string): void;
  clearSourceNavigation(): void;
  setOperationProgress(progress?: OperationProgress): void;
  undo(): void;
  redo(): void;
  setImportPreview(plan?: CloudFormationImportPlan): void;
  commitImport(plan: CloudFormationImportPlan, mode: 'merge' | 'replace'): boolean;
  startLayout(request: LayoutRequest): void;
  applyLayout(result: LayoutResult): void;
  failLayout(message: string): void;
  setAutosave(state: AutosaveState): void;
  validate(): void;
}

/** Compares ordered string arrays for shallow equality. */
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
/** Advances document revision metadata for an undoable command. */
function touch(document: DiagramDocument, command: string): DiagramDocument {
  const now = new Date().toISOString();
  return { ...document, metadata: { ...document.metadata, updatedAt: now }, revision: { number: document.revision.number + 1, lastCommand: command, updatedAt: now } };
}
/** Appends a document snapshot while enforcing the history limit. */
function boundedPush(stack: readonly DiagramDocument[], document: DiagramDocument): DiagramDocument[] {
  return [...stack, document].slice(-HISTORY_LIMIT);
}
/** Creates a store update for an undoable document mutation. */
function commitState(state: DiagramStore, document: DiagramDocument, command: string, announcement = ''): Partial<DiagramStore> {
  const next = touch(document, command);
  return { document: next, undoStack: boundedPush(state.undoStack, state.document), redoStack: [], validationIssues: validateDocument(next), announcement };
}
/** Checks whether a node moved far enough to persist a position update. */
function nodePositionChanged(node: DiagramNode, position: { x: number; y: number }): boolean {
  return Math.abs(node.position.x - position.x) > 0.001 || Math.abs(node.position.y - position.y) > 0.001;
}
/** Removes undefined entries from a shallow object copy. */
function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** Zustand hook that stores the active diagram and editor commands. */
export const useDiagramStore = create<DiagramStore>((set, get) => ({
  document: createSeedDocument(),
  selection: { nodeIds: [], edgeIds: [] },
  clipboard: { nodes: [], edges: [] },
  undoStack: [],
  redoStack: [],
  layoutState: { status: 'idle' },
  validationIssues: [],
  autosave: { status: 'idle', savedRevision: 0 },
  announcement: '',
  readOnly: false,
  inspectorTab: 'properties',

  newDocument: () => set((state) => ({ ...commitState(state, createEmptyDocument(), 'new-document', 'New diagram created.'), selection: { nodeIds: [], edgeIds: [] } })),
  loadSeed: () => set((state) => ({ ...commitState(state, createSeedDocument(), 'load-seed', 'Seed diagram loaded.'), selection: { nodeIds: [], edgeIds: [] } })),
  loadDocument: (document) => set((state) => ({ ...commitState(state, document, 'load-document', 'Diagram loaded.'), selection: { nodeIds: [], edgeIds: [] } })),
  select: (nodeIds, edgeIds = []) => set((state) => arraysEqual(state.selection.nodeIds, nodeIds) && arraysEqual(state.selection.edgeIds, edgeIds) ? state : { selection: { nodeIds: [...nodeIds], edgeIds: [...edgeIds] } }),
  clearSelection: () => set((state) => state.selection.nodeIds.length === 0 && state.selection.edgeIds.length === 0 ? state : { selection: { nodeIds: [], edgeIds: [] } }),

  applyNodeChanges: (changes) => set((state) => {
    let nodesById = state.document.nodesById;
    let changed = false;
    const selected = new Set(state.selection.nodeIds);
    let selectionChanged = false;
    for (const change of changes) {
      if (change.type === 'select') {
        const before = selected.has(change.id);
        if (change.selected && !before) { selected.add(change.id); selectionChanged = true; }
        if (!change.selected && before) { selected.delete(change.id); selectionChanged = true; }
      } else if (change.type === 'position' && change.position) {
        const node = nodesById[change.id];
        if (node && !node.locked && nodePositionChanged(node, change.position)) {
          nodesById = { ...nodesById, [change.id]: { ...node, position: change.position } };
          changed = true;
        }
      } else if (change.type === 'dimensions' && change.dimensions) {
        const node = nodesById[change.id];
        const requested = node?.kind === 'boundary' ? constrainBoundarySize({ ...state.document, nodesById }, node.id, change.dimensions) : change.dimensions;
        if (node && !node.locked && (Math.abs(node.size.width - requested.width) > 0.5 || Math.abs(node.size.height - requested.height) > 0.5)) {
          nodesById = { ...nodesById, [change.id]: { ...node, size: requested } };
          changed = true;
        }
      }
    }
    if (!changed && !selectionChanged) return state;
    return {
      ...(changed ? { document: { ...state.document, nodesById } } : {}),
      ...(selectionChanged ? { selection: { ...state.selection, nodeIds: [...selected] } } : {}),
    };
  }),
  applyEdgeChanges: (changes) => set((state) => {
    const selected = new Set(state.selection.edgeIds);
    let changed = false;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      const before = selected.has(change.id);
      if (change.selected && !before) { selected.add(change.id); changed = true; }
      if (!change.selected && before) { selected.delete(change.id); changed = true; }
    }
    return changed ? { selection: { ...state.selection, edgeIds: [...selected] } } : state;
  }),
  beginInteraction: (label) => set((state) => state.interactionBaseline ? state : { interactionBaseline: { document: state.document, label } }),
  endInteraction: (label) => set((state) => {
    const baseline = state.interactionBaseline;
    if (!baseline) return state;
    const changed = baseline.document !== state.document;
    if (!changed) return { interactionBaseline: undefined } as Partial<DiagramStore>;
    const command = label ?? baseline.label;
    const document = touch(state.document, command);
    return { document, interactionBaseline: undefined, undoStack: boundedPush(state.undoStack, baseline.document), redoStack: [], validationIssues: validateDocument(document), announcement: `${command} completed.` } as Partial<DiagramStore>;
  }),
  cancelInteraction: () => set((state) => state.interactionBaseline ? { document: state.interactionBaseline.document, interactionBaseline: undefined } : state),

  addNode: (node) => set((state) => state.document.nodesById[node.id] ? state : commitState(state, { ...state.document, nodesById: { ...state.document.nodesById, [node.id]: node }, nodeOrder: [...state.document.nodeOrder, node.id] }, 'add-node', `${node.name} added.`)),
  updateNode: (nodeId, patch, command = 'update-node') => set((state) => {
    const node = state.document.nodesById[nodeId];
    if (!node) return state;
    if (node.sourceProjection && ['cloudFormationType','properties','condition','metadata','deletionPolicy','updateReplacePolicy','cloudFormation','importStatus'].some((key) => key in patch)) return { announcement: `${node.name} is generated by Fn::ForEach; edit the authored loop instead.` } as Partial<DiagramStore>;
    const updated = { ...node, ...patch } as DiagramNode;
    if (JSON.stringify(node) === JSON.stringify(updated)) return state;
    return commitState(state, { ...state.document, nodesById: { ...state.document.nodesById, [nodeId]: updated } }, command, `${updated.name} updated.`);
  }),
  updateDeploymentGroup: (groupId, patch, command = 'update-deployment-group') => set((state) => {
    const group = state.document.deploymentGroupsById[groupId];
    if (!group) return state;
    const updated = { ...group, ...patch } as DeploymentGroup;
    if (JSON.stringify(group) === JSON.stringify(updated)) return state;
    return commitState(state, { ...state.document, deploymentGroupsById: { ...state.document.deploymentGroupsById, [groupId]: updated } }, command, `${updated.name} updated.`);
  }),
  addEdge: (edge) => set((state) => state.document.edgesById[edge.id] ? state : commitState(state, { ...state.document, edgesById: { ...state.document.edgesById, [edge.id]: edge }, edgeOrder: [...state.document.edgeOrder, edge.id] }, 'add-edge', 'Relationship added.')),
  updateEdge: (edgeId, patch, command = 'update-edge') => set((state) => {
    const edge = state.document.edgesById[edgeId];
    if (!edge) return state;
    const updated = { ...edge, ...patch };
    if (JSON.stringify(edge) === JSON.stringify(updated)) return state;
    return commitState(state, { ...state.document, edgesById: { ...state.document.edgesById, [edgeId]: updated } }, command, 'Relationship updated.');
  }),
  deleteSelection: () => set((state) => {
    if (state.readOnly) return state;
    const protectedNodes = state.selection.nodeIds.filter((id) => state.document.nodesById[id]?.sourceProjection);
    const removeNodes = new Set(state.selection.nodeIds.filter((id) => !state.document.nodesById[id]?.sourceProjection));
    const removeEdges = new Set(state.selection.edgeIds);
    for (const edge of Object.values(state.document.edgesById)) if (removeNodes.has(edge.source) || removeNodes.has(edge.target)) removeEdges.add(edge.id);
    if (removeNodes.size === 0 && removeEdges.size === 0) return protectedNodes.length ? { announcement: 'Fn::ForEach projection nodes cannot be deleted; edit the authored loop.' } : state;
    const nodesById = Object.fromEntries(Object.entries(state.document.nodesById).filter(([id]) => !removeNodes.has(id)));
    const edgesById = Object.fromEntries(Object.entries(state.document.edgesById).filter(([id]) => !removeEdges.has(id)));
    const commentsById = Object.fromEntries(Object.entries(state.document.commentsById).filter(([, comment]) => comment.target.kind !== 'node' || !removeNodes.has(comment.target.nodeId)));
    const deploymentGroupsById = Object.fromEntries(Object.entries(state.document.deploymentGroupsById).map(([id, group]) => [id, { ...group, nodeIds: group.nodeIds.filter((nodeId) => !removeNodes.has(nodeId)) }]));
    const logicalGroupsById = Object.fromEntries(Object.entries(state.document.logicalGroupsById).map(([id, group]) => [id, { ...group, nodeIds: group.nodeIds.filter((nodeId) => !removeNodes.has(nodeId)) }]));
    return { ...commitState(state, { ...state.document, nodesById, nodeOrder: state.document.nodeOrder.filter((id) => !removeNodes.has(id)), edgesById, edgeOrder: state.document.edgeOrder.filter((id) => !removeEdges.has(id)), commentsById, commentOrder: state.document.commentOrder.filter((id) => id in commentsById), deploymentGroupsById, logicalGroupsById }, 'delete-selection', 'Selection deleted.'), selection: { nodeIds: [], edgeIds: [] } };
  }),
  copySelection: () => set((state) => {
    const nodes = state.selection.nodeIds.map((id) => state.document.nodesById[id]).filter((node): node is DiagramNode => Boolean(node));
    const selected = new Set(nodes.map((node) => node.id));
    const edges = Object.values(state.document.edgesById).filter((edge) => selected.has(edge.source) && selected.has(edge.target));
    return { clipboard: { nodes, edges }, announcement: `${nodes.length} nodes copied.` };
  }),
  pasteClipboard: () => set((state) => {
    if (state.readOnly || state.clipboard.nodes.length === 0) return state;
    const idMap = new Map<string, string>();
    for (const node of state.clipboard.nodes) idMap.set(node.id, uniqueId('node'));
    const pastedNodes: DiagramNode[] = state.clipboard.nodes.map((node) => {
      const { sourceTemplateId: _sourceTemplateId, sourceLogicalId: _sourceLogicalId, sourceResourceType: _sourceResourceType, sourceProjection: _sourceProjection, cdkConstructPath: _cdkConstructPath, cdkHelper: _cdkHelper, ...manual } = node;
      void _sourceTemplateId; void _sourceLogicalId; void _sourceResourceType; void _sourceProjection; void _cdkConstructPath; void _cdkHelper;
      return { ...manual, id: idMap.get(node.id) as string, name: `${node.name} copy`, position: { x: node.position.x + 32, y: node.position.y + 32 }, physicalParentId: node.physicalParentId && idMap.has(node.physicalParentId) ? idMap.get(node.physicalParentId) : node.physicalParentId, importStatus: 'manual' } as DiagramNode;
    });
    const pastedEdges: DiagramEdge[] = state.clipboard.edges.map((edge) => {
      const { sourceTemplateId: _sourceTemplateId, importProvenance: _importProvenance, ...manual } = edge;
      void _sourceTemplateId; void _importProvenance;
      return { ...manual, id: uniqueId('edge'), source: idMap.get(edge.source) as string, target: idMap.get(edge.target) as string };
    });
    const document = { ...state.document, nodesById: { ...state.document.nodesById, ...Object.fromEntries(pastedNodes.map((node) => [node.id, node])) }, nodeOrder: [...state.document.nodeOrder, ...pastedNodes.map((node) => node.id)], edgesById: { ...state.document.edgesById, ...Object.fromEntries(pastedEdges.map((edge) => [edge.id, edge])) }, edgeOrder: [...state.document.edgeOrder, ...pastedEdges.map((edge) => edge.id)] };
    return { ...commitState(state, document, 'paste', `${pastedNodes.length} nodes pasted.`), selection: { nodeIds: pastedNodes.map((node) => node.id), edgeIds: [] } };
  }),
  duplicateSelection: () => { get().copySelection(); get().pasteClipboard(); },
  reparentNode: (nodeId, parentId) => {
    const state = get();
    if (state.readOnly) return false;
    const decision = containmentPolicy.decide(state.document, nodeId, parentId);
    if (!decision.valid) { set({ announcement: decision.message }); return false; }
    const node = state.document.nodesById[nodeId];
    if (!node || node.physicalParentId === parentId) return true;
    const position = reparentPosition(state.document, nodeId, parentId);
    const updated = omitUndefined({ ...node, physicalParentId: parentId, position });
    set((current) => {
      const nextDocument = { ...current.document, nodesById: { ...current.document.nodesById, [nodeId]: updated } };
      return current.interactionBaseline
        ? { document: nextDocument, announcement: `${node.name} reparented.` }
        : commitState(current, nextDocument, 'reparent-node', `${node.name} moved without changing its absolute position.`);
    });
    return true;
  },
  detachNode: (nodeId) => get().reparentNode(nodeId),
  toggleLock: (nodeId) => set((state) => {
    const node = state.document.nodesById[nodeId];
    if (!node) return state;
    return commitState(state, { ...state.document, nodesById: { ...state.document.nodesById, [nodeId]: { ...node, locked: !node.locked } } }, 'toggle-lock', `${node.name} ${node.locked ? 'unlocked' : 'locked'}.`);
  }),
  togglePin: (nodeId) => set((state) => {
    const node = state.document.nodesById[nodeId];
    if (!node) return state;
    return commitState(state, { ...state.document, nodesById: { ...state.document.nodesById, [nodeId]: { ...node, pinned: !node.pinned } } }, 'toggle-pin', `${node.name} ${node.pinned ? 'unpinned' : 'pinned'}.`);
  }),
  bringForward: (nodeId) => set((state) => { const document = !state.readOnly ? reorderNode(state.document, nodeId, 'forward') : undefined; return document ? commitState(state, document, 'bring-forward', 'Node brought forward.') : state; }),
  sendBackward: (nodeId) => set((state) => { const document = !state.readOnly ? reorderNode(state.document, nodeId, 'backward') : undefined; return document ? commitState(state, document, 'send-backward', 'Node sent backward.') : state; }),
  bringToFront: (nodeId) => set((state) => { const document = !state.readOnly ? reorderNode(state.document, nodeId, 'front') : undefined; return document ? commitState(state, document, 'bring-to-front', 'Node brought to front.') : state; }),
  sendToBack: (nodeId) => set((state) => { const document = !state.readOnly ? reorderNode(state.document, nodeId, 'back') : undefined; return document ? commitState(state, document, 'send-to-back', 'Node sent to back.') : state; }),
  alignSelection: (alignment) => set((state) => {
    if (state.readOnly) return state;
    const document = alignDocumentSelection(state.document, state.selection.nodeIds, alignment);
    return document ? commitState(state, document, `align-${alignment}`, `Selection aligned ${alignment}.`) : { announcement: 'Alignment requires at least two unlocked nodes with the same physical parent.' } as Partial<DiagramStore>;
  }),
  distributeSelection: (direction) => set((state) => {
    if (state.readOnly) return state;
    const document = distributeDocumentSelection(state.document, state.selection.nodeIds, direction);
    return document ? commitState(state, document, `distribute-${direction}`, `Selection distributed ${direction}ly.`) : { announcement: 'Distribution requires at least three unlocked nodes with the same physical parent.' } as Partial<DiagramStore>;
  }),
  nudgeSelection: (delta) => set((state) => {
    if (state.readOnly) return state;
    const document = nudgeDocumentSelection(state.document, state.selection.nodeIds, delta);
    return document === state.document ? state : commitState(state, document, 'keyboard-move', 'Selection moved.');
  }),
  setGridSize: (size) => set((state) => { const value = Math.max(1, Math.min(256, Math.round(size))); return state.document.preferences.gridSize === value ? state : commitState(state, { ...state.document, preferences: { ...state.document.preferences, gridSize: value } }, 'set-grid-size', `Grid spacing set to ${value}.`); }),
  setKeyboardMoveIncrement: (size) => set((state) => { const value = Math.max(1, Math.min(256, Math.round(size))); return state.document.preferences.keyboardMoveIncrement === value ? state : commitState(state, { ...state.document, preferences: { ...state.document.preferences, keyboardMoveIncrement: value } }, 'set-keyboard-increment', `Keyboard movement set to ${value}.`); }),
  addComment: (comment) => set((state) => state.readOnly || state.document.commentsById[comment.id] ? state : commitState(state, { ...state.document, commentsById: { ...state.document.commentsById, [comment.id]: comment }, commentOrder: [...state.document.commentOrder, comment.id] }, 'add-comment', 'Comment added.')),
  updateComment: (commentId, patch) => set((state) => { const comment = state.document.commentsById[commentId]; if (!comment || state.readOnly) return state; const updated = { ...comment, ...patch, updatedAt: new Date().toISOString() } as DiagramComment; return commitState(state, { ...state.document, commentsById: { ...state.document.commentsById, [commentId]: updated } }, 'update-comment', updated.resolved ? 'Comment resolved.' : 'Comment updated.'); }),
  deleteComment: (commentId) => set((state) => { if (!state.document.commentsById[commentId] || state.readOnly) return state; const commentsById = Object.fromEntries(Object.entries(state.document.commentsById).filter(([id]) => id !== commentId)); return commitState(state, { ...state.document, commentsById, commentOrder: state.document.commentOrder.filter((id) => id !== commentId) }, 'delete-comment', 'Comment deleted.'); }),
  saveFilter: (filter) => set((state) => { const exists = Boolean(state.document.savedFiltersById[filter.id]); return commitState(state, { ...state.document, savedFiltersById: { ...state.document.savedFiltersById, [filter.id]: filter }, savedFilterOrder: exists ? state.document.savedFilterOrder : [...state.document.savedFilterOrder, filter.id] }, 'save-filter', `Filter ${filter.name} saved.`); }),
  deleteFilter: (filterId) => set((state) => { if (!state.document.savedFiltersById[filterId]) return state; const savedFiltersById = Object.fromEntries(Object.entries(state.document.savedFiltersById).filter(([id]) => id !== filterId)); return commitState(state, { ...state.document, savedFiltersById, savedFilterOrder: state.document.savedFilterOrder.filter((id) => id !== filterId), ...(state.document.activeFilterId === filterId ? { activeFilterId: undefined } : {}) }, 'delete-filter', 'Filter deleted.'); }),
  setActiveFilter: (filterId) => set((state) => filterId && !state.document.savedFiltersById[filterId] || state.document.activeFilterId === filterId ? state : commitState(state, { ...state.document, activeFilterId: filterId }, 'set-active-filter', filterId ? `Filter ${state.document.savedFiltersById[filterId]?.name} applied.` : 'Filter cleared.')),
  bulkSetStack: (stackId) => set((state) => {
    if (state.readOnly || stackId && !state.document.deploymentGroupsById[stackId]) return state;
    const selected = new Set(state.selection.nodeIds.filter((id) => { const node = state.document.nodesById[id]; return node && node.kind !== 'text' && node.kind !== 'legend'; })); if (selected.size === 0) return { announcement: 'Decorative elements do not have stack ownership.' } as Partial<DiagramStore>;
    const nodesById = { ...state.document.nodesById };
    for (const id of selected) { const node = nodesById[id]; if (node) nodesById[id] = omitUndefined({ ...node, stackId }); }
    const deploymentGroupsById = Object.fromEntries(Object.entries(state.document.deploymentGroupsById).map(([id, group]) => [id, { ...group, nodeIds: id === stackId ? [...new Set([...group.nodeIds.filter((nodeId) => !selected.has(nodeId)), ...selected])] : group.nodeIds.filter((nodeId) => !selected.has(nodeId)) }]));
    return commitState(state, { ...state.document, nodesById, deploymentGroupsById }, 'bulk-stack-ownership', `${selected.size} nodes updated.`);
  }),
  bulkUpdateMembership: (field, ids, operation) => set((state) => {
    if (state.readOnly || state.selection.nodeIds.length === 0) return state;
    const selected = new Set(state.selection.nodeIds); const requested = new Set(ids); const nodesById = { ...state.document.nodesById };
    const apply = (current: readonly string[]): string[] => operation === 'replace' ? [...requested] : operation === 'add' ? [...new Set([...current, ...requested])] : current.filter((id) => !requested.has(id));
    for (const id of selected) { const node = nodesById[id]; if (node) nodesById[id] = { ...node, [field]: apply(node[field]) } as DiagramNode; }
    let logicalGroupsById = state.document.logicalGroupsById;
    if (field === 'logicalGroupIds') logicalGroupsById = Object.fromEntries(Object.entries(logicalGroupsById).map(([id, group]) => {
      const selectedAlreadyPresent = group.nodeIds.some((nodeId) => selected.has(nodeId));
      const shouldHave = operation === 'replace' ? requested.has(id) : operation === 'add' ? requested.has(id) || selectedAlreadyPresent : !requested.has(id) && selectedAlreadyPresent;
      return [id, { ...group, nodeIds: [...new Set([...group.nodeIds.filter((nodeId) => !selected.has(nodeId)), ...(shouldHave ? selected : [])])] }];
    }));
    return commitState(state, { ...state.document, nodesById, logicalGroupsById }, `bulk-${field}`, `${selected.size} nodes updated.`);
  }),
  bulkSetDiagramTag: (key, value) => set((state) => {
    const clean = key.trim(); if (!clean || state.readOnly || state.selection.nodeIds.length === 0) return state;
    const nodesById = { ...state.document.nodesById };
    for (const id of state.selection.nodeIds) { const node = nodesById[id]; if (!node) continue; const diagramTags = { ...node.diagramTags }; if (value === undefined) delete diagramTags[clean]; else diagramTags[clean] = value; nodesById[id] = { ...node, diagramTags }; }
    return commitState(state, { ...state.document, nodesById }, 'bulk-diagram-tags', `Diagram tag ${clean} updated.`);
  }),
  bulkSetCloudFormationTag: async (key, value) => {
    const clean = key.trim(); if (!clean) return;
    const specification = await loadResourceSpecification();
    set((state) => {
      if (state.readOnly) return state;
      const nodesById = { ...state.document.nodesById }; let updatedCount = 0; let skippedCount = 0;
      for (const id of state.selection.nodeIds) {
        const node = nodesById[id];
        if (!node || node.sourceProjection || node.kind !== 'aws-resource' && !(node.kind === 'boundary' && node.cloudFormation)) { skippedCount += 1; continue; }
        const resourceType = node.kind === 'aws-resource' ? node.cloudFormationType : node.cloudFormation!.type;
        const properties = node.kind === 'aws-resource' ? node.properties : node.cloudFormation!.properties;
        const tagSpec = specification.ResourceTypes[resourceType]?.Properties?.Tags;
        if (!tagSpec || tagSpec.Type !== 'List' && tagSpec.Type !== 'Map') { skippedCount += 1; continue; }
        let tags: unknown;
        if (tagSpec.Type === 'Map') { const current = typeof properties.Tags === 'object' && properties.Tags !== null && !Array.isArray(properties.Tags) ? properties.Tags as Record<string, unknown> : {}; const next = { ...current }; if (value === undefined) delete next[clean]; else next[clean] = value; tags = next; }
        else { const current = Array.isArray(properties.Tags) ? [...properties.Tags] : []; const literal = current.findIndex((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry) && (entry as Record<string, unknown>).Key === clean); if (value === undefined && literal >= 0) current.splice(literal, 1); else if (value !== undefined && literal >= 0) current[literal] = { ...(current[literal] as Record<string, unknown>), Value: value }; else if (value !== undefined) current.push({ Key: clean, Value: value }); tags = current; }
        const nextProperties = { ...properties, Tags: tags };
        nodesById[id] = node.kind === 'aws-resource' ? { ...node, properties: nextProperties } : { ...node, cloudFormation: { ...node.cloudFormation!, properties: nextProperties } };
        updatedCount += 1;
      }
      if (updatedCount === 0) return { announcement: `No selected resources support CloudFormation Tags; ${skippedCount} skipped.` } as Partial<DiagramStore>;
      return commitState(state, { ...state.document, nodesById }, 'bulk-cloudformation-tags', `${updatedCount} resources updated; ${skippedCount} skipped.`);
    });
  },
  insertPattern: (pattern, origin, targetStackId) => set((state) => {
    if (state.readOnly) return state;
    const result = insertPattern(state.document, pattern, origin, targetStackId);
    return { ...commitState(state, result.document, 'insert-pattern', `${pattern.name} inserted.`), selection: { nodeIds: result.nodeIds, edgeIds: [] } };
  }),
  replaceWithStarter: (starterId) => set((state) => {
    if (state.readOnly) return state; const document = createStarter(starterId); if (!document) return state;
    return { ...commitState(state, document, 'load-starter', `${document.metadata.title} starter loaded.`), selection: { nodeIds: [], edgeIds: [] } };
  }),
  setViewMode: (mode) => set((state) => state.document.currentViewMode === mode ? state : commitState(state, { ...state.document, currentViewMode: mode }, 'set-view-mode')),
  setLayerVisible: (layer, visible) => set((state) => state.document.visibleLayers[layer] === visible ? state : commitState(state, { ...state.document, visibleLayers: { ...state.document.visibleLayers, [layer]: visible } }, 'set-layer-visibility')),
  setViewport: (viewport) => set((state) => Math.abs(state.document.viewport.x - viewport.x) < 0.01 && Math.abs(state.document.viewport.y - viewport.y) < 0.01 && Math.abs(state.document.viewport.zoom - viewport.zoom) < 0.001 ? state : { document: { ...state.document, viewport } }),
  toggleSnap: () => set((state) => commitState(state, { ...state.document, preferences: { ...state.document.preferences, snapToGrid: !state.document.preferences.snapToGrid } }, 'toggle-snap')),
  setReadOnly: (value) => set((state) => state.readOnly === value ? state : { readOnly: value, announcement: value ? 'Presentation mode enabled.' : 'Editing enabled.' }),
  setInspectorTab: (tab) => set((state) => state.inspectorTab === tab && (tab === 'template' || !state.sourceNavigation) ? state : { inspectorTab: tab, ...(tab === 'template' ? {} : { sourceNavigation: undefined }) }),
  openSource: (nodeId, path) => set((state) => {
    const node = state.document.nodesById[nodeId];
    if (!node) return state;
    const targetPath = path ?? node.sourcePropertyPath ?? (node.sourceLogicalId ? `Resources.${node.sourceLogicalId}` : '');
    return { selection: { nodeIds: [nodeId], edgeIds: [] }, inspectorTab: 'template', sourceNavigation: { nodeId, path: targetPath }, announcement: `Opened source for ${node.name}.` };
  }),
  clearSourceNavigation: () => set({ sourceNavigation: undefined }),
  setOperationProgress: (operationProgress) => set(operationProgress ? { operationProgress, announcement: operationProgress.message } : { operationProgress: undefined } as Partial<DiagramStore>),
  undo: () => set((state) => {
    const previous = state.undoStack.at(-1); if (!previous) return state;
    return { document: previous, undoStack: state.undoStack.slice(0, -1), redoStack: boundedPush(state.redoStack, state.document), selection: { nodeIds: [], edgeIds: [] }, validationIssues: validateDocument(previous), announcement: 'Undo completed.' };
  }),
  redo: () => set((state) => {
    const next = state.redoStack.at(-1); if (!next) return state;
    return { document: next, redoStack: state.redoStack.slice(0, -1), undoStack: boundedPush(state.undoStack, state.document), selection: { nodeIds: [], edgeIds: [] }, validationIssues: validateDocument(next), announcement: 'Redo completed.' };
  }),
  setImportPreview: (plan) => set(plan ? { importPreview: plan, announcement: 'CloudFormation import preview ready.' } : { importPreview: undefined } as Partial<DiagramStore>),
  commitImport: (plan, mode) => {
    const state = get();
    if (plan.diagnostics.some((item) => item.blocking)) { set({ announcement: 'Import blocked by validation errors.' }); return false; }
    if (plan.deploymentGroups.some((group) => group.kind === 'nested-stack' && !group.associationConfirmed)) { set({ announcement: 'Import blocked until every nested stack association is explicitly confirmed.' }); return false; }
    if (plan.deploymentGroups.some((group) => group.kind === 'stackset' && validateStackSetTargets(group.permissionModel, group.targetGroups, group.operationPreferences).length > 0)) { set({ announcement: 'Import blocked by invalid StackSet targets or deployment preferences.' }); return false; }
    const duplicate = Object.values(state.document.importSourcesById).some((source) => source.sourceIdentity === plan.source.sourceIdentity && arraysEqual(source.contentHashes, plan.source.contentHashes));
    if (duplicate) { set({ announcement: 'This exact CloudFormation source is already imported.' }); return true; }
    const unique = (values: readonly string[]) => [...new Set(values)];
    let base = mode === 'replace' ? createEmptyDocument('Imported CloudFormation architecture') : state.document;
    if (plan.reconciliation && mode === 'merge') {
      const affectedOwners = new Set(plan.deploymentGroups.map((group) => group.id));
      const previousImportedNodes = Object.values(base.nodesById).filter((node) => node.sourceTemplateId && affectedOwners.has(node.stackId ?? node.stackSetId ?? ''));
      const previousImportedIds = new Set(previousImportedNodes.map((node) => node.id));
      const incomingIds = new Set(plan.nodes.map((node) => node.id));
      const removedEndpointIds = new Set([...previousImportedIds].filter((id) => !incomingIds.has(id)));
      const previousTemplateIds = new Set(previousImportedNodes.map((node) => node.sourceTemplateId).filter((id): id is string => Boolean(id)));
      const retainedNodes = Object.fromEntries(Object.entries(base.nodesById).filter(([id]) => !previousImportedIds.has(id)));
      const retainedEdges = Object.fromEntries(Object.entries(base.edgesById).filter(([, edge]) => {
        if (edge.sourceTemplateId && previousTemplateIds.has(edge.sourceTemplateId)) return false;
        return !removedEndpointIds.has(edge.source) && !removedEndpointIds.has(edge.target);
      }));
      const affectedStackSets = new Set(plan.deploymentGroups.filter((group) => group.kind === 'stackset').map((group) => group.id));
      const retainedInstances = Object.fromEntries(Object.entries(base.stackInstancesById).filter(([, instance]) => !affectedStackSets.has(instance.stackSetId)));
      base = {
        ...base,
        nodesById: retainedNodes,
        nodeOrder: base.nodeOrder.filter((id) => !previousImportedIds.has(id)),
        edgesById: retainedEdges,
        edgeOrder: base.edgeOrder.filter((id) => id in retainedEdges),
        stackInstancesById: retainedInstances,
        stackInstanceOrder: base.stackInstanceOrder.filter((id) => id in retainedInstances),
      };
    }
    const nodesById = { ...base.nodesById, ...Object.fromEntries(plan.nodes.map((node) => [node.id, node])) };
    const edgesById = { ...base.edgesById, ...Object.fromEntries(plan.edges.map((edge) => [edge.id, edge])) };
    const incomingGroups = plan.deploymentGroups.map((group) => {
      const current = base.deploymentGroupsById[group.id];
      const manualNodeIds = current?.nodeIds.filter((id) => !state.document.nodesById[id]?.sourceTemplateId) ?? [];
      return { ...group, nodeIds: unique([...manualNodeIds, ...group.nodeIds]) };
    });
    const deploymentGroupsById = { ...base.deploymentGroupsById, ...Object.fromEntries(incomingGroups.map((group) => [group.id, group])) };
    const stackInstancesById = { ...base.stackInstancesById, ...Object.fromEntries(plan.stackInstances.map((instance) => [instance.id, instance])) };
    const templatesById = { ...base.templatesById, ...Object.fromEntries(plan.templates.map((template) => [template.id, template])) };
    const importSourcesById = { ...base.importSourcesById, [plan.source.id]: plan.source };
    const document: DiagramDocument = {
      ...base, nodesById, nodeOrder: unique([...base.nodeOrder, ...plan.nodes.map((node) => node.id)]), edgesById, edgeOrder: unique([...base.edgeOrder, ...plan.edges.map((edge) => edge.id)]),
      deploymentGroupsById, deploymentGroupOrder: unique([...base.deploymentGroupOrder, ...incomingGroups.map((group) => group.id)]),
      stackInstancesById, stackInstanceOrder: unique([...base.stackInstanceOrder, ...plan.stackInstances.map((instance) => instance.id)]),
      templatesById, templateOrder: unique([...base.templateOrder, ...plan.templates.map((template) => template.id)]),
      importSourcesById, importSourceOrder: unique([...base.importSourceOrder, plan.source.id]),
    };
    set((current) => ({ ...commitState(current, document, plan.reconciliation ? 'reimport-cloudformation' : 'import-cloudformation', `${plan.summary.resourceCount} CloudFormation resources imported.`), importPreview: undefined }));
    return true;
  },
  startLayout: (request) => set({ layoutState: { status: 'running', request }, announcement: 'Automatic layout started.' }),
  applyLayout: (result) => set((state) => {
    if (state.layoutState.request?.id !== result.requestId) return state;
    if (!result.changed) return { layoutState: { status: 'complete', message: 'Layout already stable.' }, announcement: 'Layout completed with no coordinate changes.' };
    let nodesById = state.document.nodesById;
    for (const [id, position] of Object.entries(result.positions)) {
      const node = nodesById[id]; if (!node || node.locked || node.pinned) continue;
      nodesById = { ...nodesById, [id]: { ...node, position, ...(result.sizes[id] ? { size: result.sizes[id] } : {}) } };
    }
    return { ...commitState(state, { ...state.document, nodesById }, 'automatic-layout', 'Automatic layout completed.'), layoutState: { status: 'complete', message: result.diagnostics.length ? `${result.diagnostics.length} diagnostics.` : 'Layout completed.' } };
  }),
  failLayout: (message) => set({ layoutState: { status: 'error', message }, announcement: `Layout failed: ${message}` }),
  setAutosave: (autosave) => set({ autosave }),
  validate: () => set((state) => ({ validationIssues: validateDocument(state.document) })),
}));

/** Creates a manually added AWS resource node with default canvas metadata. */
export function createManualResourceNode(name: string, cloudFormationType: string, resourceType: AwsResourceType, position: { x: number; y: number }, physicalParentId?: string): DiagramNode {
  return omitUndefined({ id: uniqueId('node'), name, kind: 'aws-resource', resourceType, cloudFormationType, properties: {}, position, size: { width: 184, height: 78 }, physicalParentId, logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 10, userMetadata: {}, diagramTags: {}, annotations: [], importStatus: 'manual' }) as DiagramNode;
}

export { HISTORY_LIMIT };

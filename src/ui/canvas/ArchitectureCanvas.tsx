/**
 * @file Interactive architecture diagram canvas.
 * @module ui/canvas/ArchitectureCanvas
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders React Flow, handles palette drops, relationships, layout actions, dragging, and context menus.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Node as FlowNode,
  type OnNodeDrag,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useShallow } from 'zustand/react/shallow';
import { documentToFlowEdges, documentToFlowNodes, type ArchitectureFlowNode } from '../../reactflow/adapters';
import { DEFAULT_EDGE_OPTIONS, EDGE_TYPES, FIT_VIEW_OPTIONS, NODE_TYPES } from '../../reactflow/registries';
import { useDiagramStore } from '../../store/useDiagramStore';
import { uniqueId } from '../../domain/ids';
import type { BoundaryNode, ControlNode, DiagramNode, ExternalReferenceNode, LayoutRequest } from '../../domain/types';
import { PALETTE_MIME, type PalettePayload } from '../palette/types';
import { DiagramLayoutService } from '../../layout/service';
import { RelationshipEditorDialog } from '../dialogs/RelationshipEditorDialog';
import { getAbsolutePosition } from '../../domain/coordinates';
import { FilterBar } from './FilterBar';
import { CommentLayer } from './CommentLayer';

/** Shared layout service used by canvas layout actions. */
const layoutService = new DiagramLayoutService();

/** Creates shared defaults for nodes dropped from the palette. */
function commonNode(id: string, name: string, position: { x: number; y: number }, size: { width: number; height: number }) {
  return { id, name, position, size, logicalGroupIds: [], attachedControlIds: [], securityGroupIds: [], locked: false, pinned: false, collapsed: false, zIndex: 10, userMetadata: {}, diagramTags: {}, annotations: [], importStatus: 'manual' as const };
}
/** Converts a palette drag payload into a new diagram node. */
function nodeFromPayload(payload: PalettePayload, position: { x: number; y: number }): DiagramNode | undefined {
  const id = uniqueId('node');
  if (payload.category === 'boundary') {
    const size = ['organization','organizational-unit','account','region','vpc'].includes(payload.boundaryType) ? { width: 520, height: 360 } : payload.boundaryType === 'availability-zone' ? { width: 430, height: 260 } : { width: 360, height: 180 };
    return { ...commonNode(id, payload.name, position, size), kind: 'boundary', boundaryType: payload.boundaryType, zIndex: 0 } as BoundaryNode;
  }
  if (payload.category === 'resource') return { ...commonNode(id, payload.name, position, { width: 184, height: 78 }), kind: 'aws-resource', resourceType: payload.resourceType, cloudFormationType: payload.cloudFormationType, properties: {} };
  if (payload.category === 'control') return { ...commonNode(id, payload.name, position, { width: 190, height: 78 }), kind: 'control', controlType: payload.controlType, properties: {} } as ControlNode;
  if (payload.category === 'external-reference') return { ...commonNode(id, payload.name, position, { width: 200, height: 72 }), kind: 'external-reference', referenceType: 'resource', referenceValue: payload.name, resolved: false } as ExternalReferenceNode;
  if (payload.category === 'text') return { ...commonNode(id, payload.name, position, { width: 240, height: 72 }), kind: 'text', text: payload.name, style: { fontSize: 18, fontWeight: 'normal', alignment: 'left', color: '#172b4d' } };
  if (payload.category === 'legend') return { ...commonNode(id, payload.name, position, { width: 240, height: 180 }), kind: 'legend', title: payload.name, mode: 'automatic', entries: [] };
  return undefined;
}

/** Screen position and target node for the canvas context menu. */
interface ContextMenuState { readonly x: number; readonly y: number; readonly nodeId: string; }

/** Renders the interactive React Flow architecture canvas. */
export function ArchitectureCanvas() {
  const { screenToFlowPosition, flowToScreenPosition, getIntersectingNodes, fitView } = useReactFlow();
  const { document, selection, readOnly, layoutState, validationIssues } = useDiagramStore(useShallow((state) => ({ document: state.document, selection: state.selection, readOnly: state.readOnly, layoutState: state.layoutState, validationIssues: state.validationIssues })));
  const actions = useDiagramStore(useShallow((state) => ({
    applyNodeChanges: state.applyNodeChanges, applyEdgeChanges: state.applyEdgeChanges, beginInteraction: state.beginInteraction, endInteraction: state.endInteraction, cancelInteraction: state.cancelInteraction,
    clearSelection: state.clearSelection, addNode: state.addNode, reparentNode: state.reparentNode, detachNode: state.detachNode, copySelection: state.copySelection, pasteClipboard: state.pasteClipboard,
    duplicateSelection: state.duplicateSelection, deleteSelection: state.deleteSelection, toggleLock: state.toggleLock, togglePin: state.togglePin, bringForward: state.bringForward, sendBackward: state.sendBackward, bringToFront: state.bringToFront, sendToBack: state.sendToBack,
    alignSelection: state.alignSelection, distributeSelection: state.distributeSelection, nudgeSelection: state.nudgeSelection, setGridSize: state.setGridSize, setKeyboardMoveIncrement: state.setKeyboardMoveIncrement,
    addComment: state.addComment, updateComment: state.updateComment, deleteComment: state.deleteComment,
    startLayout: state.startLayout, applyLayout: state.applyLayout, failLayout: state.failLayout, setViewport: state.setViewport, openSource: state.openSource,
  })));
  const nodes = useMemo(() => documentToFlowNodes(document, selection, validationIssues), [document, selection, validationIssues]);
  const edges = useMemo(() => documentToFlowEdges(document, selection, validationIssues), [document, selection, validationIssues]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [pendingConnection, setPendingConnection] = useState<Connection>();
  const [showResolvedComments, setShowResolvedComments] = useState(false);

  const runLayout = useCallback((scope: LayoutRequest['scope'] = 'all') => {
    const request: LayoutRequest = {
      id: uniqueId('layout'), direction: document.preferences.layoutDirection, density: document.preferences.layoutDensity, mode: document.currentViewMode === 'infrastructure' ? 'physical-hierarchy' : 'dependencies',
      scope, selectedNodeIds: selection.nodeIds, onlyUnpositioned: scope === 'newly-imported' || document.layoutPreferences.onlyUnpositioned, createdAt: new Date().toISOString(),
    };
    actions.startLayout(request);
    void layoutService.layout(document, request).then((result) => { if (result) actions.applyLayout(result); }, (error: unknown) => actions.failLayout(error instanceof Error ? error.message : String(error)));
  }, [actions, document, selection.nodeIds]);

  const onConnect = useCallback((connection: Connection) => {
    if (readOnly || !connection.source || !connection.target) return;
    setPendingConnection(connection);
  }, [readOnly]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    if (readOnly) return;
    const raw = event.dataTransfer.getData(PALETTE_MIME);
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as PalettePayload;
      const node = nodeFromPayload(payload, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
      if (node) actions.addNode(node);
    } catch { /* ignored invalid browser drag payload */ }
  }, [actions, readOnly, screenToFlowPosition]);

  const onNodeDrag: OnNodeDrag<ArchitectureFlowNode> = useCallback((event, activeNode) => {
    const live = useDiagramStore.getState().document; const active = live.nodesById[activeNode.id]; if (!active) return;
    const origin = getAbsolutePosition(live, active.id); const threshold = 6 / Math.max(live.viewport.zoom, 0.08);
    const xAnchors = [origin.x, origin.x + active.size.width / 2, origin.x + active.size.width];
    const yAnchors = [origin.y, origin.y + active.size.height / 2, origin.y + active.size.height];
    const candidates = Object.values(live.nodesById).filter((node) => node.id !== active.id && node.physicalParentId === active.physicalParentId);
    let bestX: { value: number; delta: number } | undefined; let bestY: { value: number; delta: number } | undefined;
    for (const candidate of candidates) {
      const position = getAbsolutePosition(live, candidate.id); const xs = [position.x, position.x + candidate.size.width / 2, position.x + candidate.size.width]; const ys = [position.y, position.y + candidate.size.height / 2, position.y + candidate.size.height];
      for (const source of xAnchors) for (const target of xs) { const delta = target - source; if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = { value: target, delta }; }
      for (const source of yAnchors) for (const target of ys) { const delta = target - source; if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = { value: target, delta }; }
    }
    const surface = globalThis.document.getElementById('canvas-surface')?.getBoundingClientRect();
    setGuides({ ...(bestX ? { x: flowToScreenPosition({ x: bestX.value, y: 0 }).x - (surface?.left ?? 0) } : {}), ...(bestY ? { y: flowToScreenPosition({ x: 0, y: bestY.value }).y - (surface?.top ?? 0) } : {}) });
    if (!event.altKey && (bestX || bestY)) actions.applyNodeChanges([{ id: active.id, type: 'position', position: { x: active.position.x + (bestX?.delta ?? 0), y: active.position.y + (bestY?.delta ?? 0) }, dragging: true }]);
  }, [actions, flowToScreenPosition]);

  const onNodeDragStop: OnNodeDrag<ArchitectureFlowNode> = useCallback((event, activeNode) => {
    setGuides({});
    const domainDocument = useDiagramStore.getState().document;
    const pointer = 'clientX' in event
      ? { x: event.clientX, y: event.clientY }
      : { x: event.changedTouches[0]?.clientX ?? 0, y: event.changedTouches[0]?.clientY ?? 0 };
    const hitIds = [...new Set(globalThis.document.elementsFromPoint(pointer.x, pointer.y)
      .map((element) => element.closest<HTMLElement>('.react-flow__node')?.dataset.id)
      .filter((id): id is string => Boolean(id && id !== activeNode.id)))];
    const hitCandidates = hitIds
      .map((id) => domainDocument.nodesById[id])
      .filter((node): node is BoundaryNode => node?.kind === 'boundary')
      .map((node) => ({ id: node.id, area: node.size.width * node.size.height }));
    const intersectingCandidates = getIntersectingNodes(activeNode as FlowNode, true)
      .filter((node) => node.id !== activeNode.id && (node.data as ArchitectureFlowNode['data'] | undefined)?.domain.kind === 'boundary')
      .map((node) => ({ id: node.id, area: (node.measured?.width ?? node.width ?? 0) * (node.measured?.height ?? node.height ?? 0) }));
    const candidate = [...hitCandidates, ...intersectingCandidates]
      .filter((value, index, values) => values.findIndex((other) => other.id === value.id) === index)
      .sort((a, b) => a.area - b.area)[0];
    const current = domainDocument.nodesById[activeNode.id];
    if (candidate && candidate.id !== current?.physicalParentId) {
      const valid = actions.reparentNode(activeNode.id, candidate.id);
      if (!valid) { actions.cancelInteraction(); return; }
    }
    actions.endInteraction('move-node');
  }, [actions, getIntersectingNodes]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target as HTMLElement).isContentEditable) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); actions.copySelection(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); actions.pasteClipboard(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); actions.duplicateSelection(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) { event.preventDefault(); actions.deleteSelection(); }
    if (event.key.startsWith('Arrow') && selection.nodeIds.length > 0 && !readOnly) { event.preventDefault(); const amount = document.preferences.keyboardMoveIncrement * (event.shiftKey ? 10 : 1); actions.nudgeSelection({ x: event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0, y: event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0 }); }
  };

  const addComment = (targetNodeId?: string): void => {
    const message = globalThis.prompt?.('Comment'); if (!message?.trim()) return; const now = new Date().toISOString();
    actions.addComment({ id: uniqueId('comment'), message: message.trim(), target: targetNodeId ? { kind: 'node', nodeId: targetNodeId, offset: { x: 12, y: 0 } } : { kind: 'canvas', position: { x: (-document.viewport.x + 420) / document.viewport.zoom, y: (-document.viewport.y + 220) / document.viewport.zoom } }, resolved: false, createdAt: now, updatedAt: now });
  };

  const selectedNode = selection.nodeIds.length === 1 ? document.nodesById[selection.nodeIds[0] ?? ''] : undefined;
  const breadcrumbs: string[] = [];
  let current = selectedNode;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) { breadcrumbs.unshift(current.name); visited.add(current.id); current = current.physicalParentId ? document.nodesById[current.physicalParentId] : undefined; }
  const stackInstances = document.stackInstanceOrder.map((id) => document.stackInstancesById[id]).filter((instance): instance is NonNullable<typeof instance> => Boolean(instance));

  return (
    <main id="canvas-surface" className="canvas-surface" onKeyDown={onKeyDown} tabIndex={0} aria-label="AWS architecture diagram canvas">
      <ReactFlow<ArchitectureFlowNode>
        nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onNodesChange={actions.applyNodeChanges} onEdgesChange={actions.applyEdgeChanges} onConnect={onConnect}
        onNodeDragStart={() => actions.beginInteraction('move-node')} onNodeDrag={onNodeDrag} onNodeDragStop={onNodeDragStop}
        onPaneClick={() => { actions.clearSelection(); setContextMenu(undefined); }}
        onNodeContextMenu={(event, node) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id }); }}
        onDrop={onDrop} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
        onMoveEnd={(_event, viewport) => actions.setViewport(viewport)}
        defaultViewport={document.viewport} minZoom={0.08} maxZoom={2.5} fitViewOptions={FIT_VIEW_OPTIONS}
        snapToGrid={document.preferences.snapToGrid} snapGrid={[document.preferences.gridSize, document.preferences.gridSize]} nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable
        deleteKeyCode={null} multiSelectionKeyCode={['Meta', 'Control']} selectionOnDrag panOnDrag={[1, 2]} proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={document.preferences.gridSize} size={1} />
        <Controls position="bottom-left" showInteractive={!readOnly} />
        <MiniMap position="bottom-right" pannable zoomable nodeStrokeWidth={3} />
        <Panel position="top-left" className="canvas-panel-stack">
          <div className="canvas-toolbar" role="toolbar" aria-label="Canvas actions">
            <button type="button" onClick={() => void fitView(FIT_VIEW_OPTIONS)}>Fit</button>
            <button type="button" onClick={() => runLayout('all')} disabled={layoutState.status === 'running'}>{layoutState.status === 'running' ? 'Laying out…' : 'Auto layout'}</button>
            <button type="button" onClick={() => runLayout('selected')} disabled={selection.nodeIds.length === 0 || layoutState.status === 'running'}>Layout selection</button>
            <button type="button" onClick={() => runLayout('newly-imported')} disabled={layoutState.status === 'running'}>Layout imported</button>
            <details><summary>Align</summary><div className="toolbar-menu">{(['left','center','right','top','middle','bottom'] as const).map((value) => <button key={value} type="button" onClick={() => actions.alignSelection(value)}>{value}</button>)}<button type="button" onClick={() => actions.distributeSelection('horizontal')}>Distribute horizontally</button><button type="button" onClick={() => actions.distributeSelection('vertical')}>Distribute vertically</button></div></details>
            <details><summary>Grid</summary><div className="toolbar-menu"><label>Spacing<input type="number" min="1" max="256" value={document.preferences.gridSize} onChange={(event) => actions.setGridSize(Number(event.target.value))} /></label><label>Keyboard step<input type="number" min="1" max="256" value={document.preferences.keyboardMoveIncrement} onChange={(event) => actions.setKeyboardMoveIncrement(Number(event.target.value))} /></label></div></details>
            <button type="button" onClick={() => addComment()}>Add comment</button><label className="inline-check"><input type="checkbox" checked={showResolvedComments} onChange={(event) => setShowResolvedComments(event.target.checked)} />Resolved comments</label>
          </div>
          <FilterBar />
          <nav className="breadcrumbs" aria-label="Physical placement breadcrumb">{breadcrumbs.length > 0 ? breadcrumbs.map((name, index) => <span key={`${name}-${index}`}>{name}</span>) : <span>Diagram root</span>}</nav>
        </Panel>
        {document.currentViewMode === 'deployment' && stackInstances.length > 0 && <Panel position="top-right" className="instance-overlay"><strong>StackSet instances</strong>{stackInstances.map((instance) => <span key={instance.id}>{instance.accountId} · {instance.region} · {instance.status ?? 'unknown'}</span>)}</Panel>}
      </ReactFlow>
      {guides.x !== undefined && <div className="alignment-guide vertical" style={{ left: guides.x }} />}
      {guides.y !== undefined && <div className="alignment-guide horizontal" style={{ top: guides.y }} />}
      {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label="Node actions">
        <button role="menuitem" onClick={() => { actions.toggleLock(contextMenu.nodeId); setContextMenu(undefined); }}>Lock / unlock</button>
        <button role="menuitem" onClick={() => { actions.togglePin(contextMenu.nodeId); setContextMenu(undefined); }}>Pin / unpin</button>
        <button role="menuitem" onClick={() => { actions.detachNode(contextMenu.nodeId); setContextMenu(undefined); }}>Detach</button>
        <button role="menuitem" onClick={() => { actions.bringForward(contextMenu.nodeId); setContextMenu(undefined); }}>Bring forward</button>
        <button role="menuitem" onClick={() => { actions.sendBackward(contextMenu.nodeId); setContextMenu(undefined); }}>Send backward</button>
        <button role="menuitem" onClick={() => { actions.bringToFront(contextMenu.nodeId); setContextMenu(undefined); }}>Bring to front</button>
        <button role="menuitem" onClick={() => { actions.sendToBack(contextMenu.nodeId); setContextMenu(undefined); }}>Send to back</button>
        <button role="menuitem" onClick={() => { addComment(contextMenu.nodeId); setContextMenu(undefined); }}>Add comment</button>
        <button role="menuitem" onClick={() => { actions.openSource(contextMenu.nodeId); setContextMenu(undefined); }}>View CloudFormation source</button>
      </div>}
      <CommentLayer document={document} showResolved={showResolvedComments} onUpdate={actions.updateComment} onDelete={actions.deleteComment} />
      <RelationshipEditorDialog key={`${pendingConnection?.source ?? ''}:${pendingConnection?.target ?? ''}`} open={Boolean(pendingConnection?.source && pendingConnection.target)} sourceId={pendingConnection?.source ?? ''} targetId={pendingConnection?.target ?? ''} sourceHandle={pendingConnection?.sourceHandle ?? undefined} targetHandle={pendingConnection?.targetHandle ?? undefined} onClose={() => setPendingConnection(undefined)} />
    </main>
  );
}

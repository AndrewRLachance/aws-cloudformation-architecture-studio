/**
 * @file ELK graph translation utilities.
 * @module layout/elkGraph
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file converts architecture documents into ELK graphs and converts layout results back into diagram coordinates.
 */
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramDocument, LayoutRequest, LayoutResult, Point, Size } from '../domain/types';
import { containmentPolicy } from '../domain/containment';
import { stableId } from '../domain/ids';

/** Returns ELK spacing values for the requested layout density. */
function spacing(request: LayoutRequest): { node: number; layer: number; padding: number } {
  if (request.density === 'compact') return { node: 28, layer: 52, padding: 24 };
  if (request.density === 'spacious') return { node: 72, layer: 130, padding: 48 };
  return { node: 48, layer: 84, padding: 32 };
}

/** Builds a hierarchical ELK graph from the current diagram and layout request. */
export function buildElkGraph(document: DiagramDocument, request: LayoutRequest): ElkNode {
  const scope = request.scope === 'selected' && request.selectedNodeIds.length > 0 ? new Set(request.selectedNodeIds) : new Set(document.nodeOrder);
  const selected = document.nodeOrder.filter((id) => scope.has(id)).map((id) => document.nodesById[id]).filter((node): node is NonNullable<typeof node> => Boolean(node));
  const spacingOptions = spacing(request);
  const childrenByParent = new Map<string | undefined, string[]>();
  for (const node of selected) {
    if (node.locked || node.pinned) continue;
    if (request.onlyUnpositioned && (Math.abs(node.position.x) > 0.01 || Math.abs(node.position.y) > 0.01)) continue;
    const parent = node.physicalParentId && scope.has(node.physicalParentId) ? node.physicalParentId : undefined;
    const list = childrenByParent.get(parent) ?? [];
    list.push(node.id);
    childrenByParent.set(parent, list);
  }
  const makeNode = (id: string): ElkNode => {
    const node = document.nodesById[id];
    const children = (childrenByParent.get(id) ?? []).sort().map(makeNode);
    return {
      id,
      width: Math.max(node?.size.width ?? 180, children.length > 0 ? 320 : 1),
      height: Math.max(node?.size.height ?? 76, children.length > 0 ? 220 : 1),
      ...(children.length > 0 ? { children } : {}),
      layoutOptions: children.length > 0 ? {
        'elk.algorithm': 'layered',
        'elk.direction': request.direction,
        'elk.padding': `[top=${spacingOptions.padding + 32},left=${spacingOptions.padding},bottom=${spacingOptions.padding},right=${spacingOptions.padding}]`,
        'elk.spacing.nodeNode': String(spacingOptions.node),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(spacingOptions.layer),
      } : undefined,
    };
  };
  const rootIds = (childrenByParent.get(undefined) ?? []).sort();
  const eligible = new Set(selected.filter((node) => !node.locked && !node.pinned).map((node) => node.id));
  const domainEdges = document.edgeOrder.flatMap((id) => { const edge = document.edgesById[id]; return edge ? [edge] : []; });
  const edges: ElkExtendedEdge[] = domainEdges.filter((edge) => eligible.has(edge.source) && eligible.has(edge.target)).sort((a, b) => a.id.localeCompare(b.id)).map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }));
  return {
    id: 'root',
    children: rootIds.map(makeNode),
    edges,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': request.direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(spacingOptions.node),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(spacingOptions.layer),
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.randomSeed': '1',
    },
  };
}

/** Converts a completed ELK graph back into diagram positions and sizes. */
export function applyElkGraph(document: DiagramDocument, request: LayoutRequest, graph: ElkNode): LayoutResult {
  const positions: Record<string, Point> = {};
  const sizes: Record<string, Size> = {};
  const diagnostics: LayoutResult['diagnostics'][number][] = [];
  const visit = (node: ElkNode): void => {
    if (node.id !== 'root') {
      const domainNode = document.nodesById[node.id];
      if (domainNode) {
        const parentId = domainNode.physicalParentId;
        const decision = containmentPolicy.decide(document, node.id, parentId);
        if (!decision.valid) diagnostics.push({ id: stableId('layout-diagnostic', request.id, node.id, decision.reasonCode), severity: 'error', code: decision.reasonCode, message: decision.message, nodeId: node.id });
        else {
          positions[node.id] = { x: node.x ?? domainNode.position.x, y: node.y ?? domainNode.position.y };
          if (node.children && node.children.length > 0) sizes[node.id] = { width: Math.max(node.width ?? domainNode.size.width, domainNode.size.width), height: Math.max(node.height ?? domainNode.size.height, domainNode.size.height) };
        }
      }
    }
    node.children?.forEach(visit);
  };
  graph.children?.forEach(visit);
  const epsilon = document.layoutPreferences.epsilon;
  const changed = Object.entries(positions).some(([id, point]) => {
    const current = document.nodesById[id]?.position;
    return current && (Math.abs(current.x - point.x) > epsilon || Math.abs(current.y - point.y) > epsilon);
  }) || Object.entries(sizes).some(([id, size]) => {
    const current = document.nodesById[id]?.size;
    return current && (Math.abs(current.width - size.width) > epsilon || Math.abs(current.height - size.height) > epsilon);
  });
  return { requestId: request.id, positions, sizes, diagnostics, changed };
}

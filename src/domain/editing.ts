/** Pure geometry and ordering operations used by diagram editing commands. */
import type { DiagramDocument, DiagramNode, Point, Size } from './types';
import { absoluteToRelative, getAbsolutePosition } from './coordinates';

export const BOUNDARY_PADDING = 24;
export const BOUNDARY_MIN_SIZE: Size = { width: 220, height: 140 };
export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type Distribution = 'horizontal' | 'vertical';

export interface NodeRect extends Point, Size { readonly right: number; readonly bottom: number; readonly centerX: number; readonly centerY: number; }

export interface NodeOverlap {
  readonly firstNodeId: string;
  readonly secondNodeId: string;
}

export function nodeRect(document: DiagramDocument, node: DiagramNode): NodeRect {
  const position = getAbsolutePosition(document, node.id);
  return { ...position, ...node.size, right: position.x + node.size.width, bottom: position.y + node.size.height, centerX: position.x + node.size.width / 2, centerY: position.y + node.size.height / 2 };
}

function isAncestor(document: DiagramDocument, ancestorId: string, nodeId: string): boolean {
  let parentId = document.nodesById[nodeId]?.physicalParentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === ancestorId) return true;
    visited.add(parentId);
    parentId = document.nodesById[parentId]?.physicalParentId;
  }
  return false;
}

/** Finds intersecting nodes that do not have an intentional containment relationship. */
export function findUnexpectedNodeOverlaps(document: DiagramDocument): NodeOverlap[] {
  const nodes = document.nodeOrder.map((id) => document.nodesById[id]).filter((node): node is DiagramNode => Boolean(node));
  const overlaps: NodeOverlap[] = [];
  for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
    const first = nodes[firstIndex]!;
    const firstRect = nodeRect(document, first);
    for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
      const second = nodes[secondIndex]!;
      if (isAncestor(document, first.id, second.id) || isAncestor(document, second.id, first.id)) continue;
      const secondRect = nodeRect(document, second);
      if (firstRect.x < secondRect.right && firstRect.right > secondRect.x && firstRect.y < secondRect.bottom && firstRect.bottom > secondRect.y) {
        overlaps.push({ firstNodeId: first.id, secondNodeId: second.id });
      }
    }
  }
  return overlaps;
}

function editableSelection(document: DiagramDocument, ids: readonly string[], minimum: number): DiagramNode[] | undefined {
  const nodes = ids.map((id) => document.nodesById[id]).filter((node): node is DiagramNode => Boolean(node));
  if (nodes.length < minimum || nodes.some((node) => node.locked)) return undefined;
  const parent = nodes[0]?.physicalParentId;
  return nodes.every((node) => node.physicalParentId === parent) ? nodes : undefined;
}

function reposition(document: DiagramDocument, nodes: readonly DiagramNode[], absolute: Readonly<Record<string, Point>>): DiagramDocument {
  const nodesById = { ...document.nodesById };
  for (const node of nodes) {
    const target = absolute[node.id];
    if (target) nodesById[node.id] = { ...node, position: absoluteToRelative(document, target, node.physicalParentId) };
  }
  return { ...document, nodesById };
}

/** Aligns two or more unlocked sibling nodes without reparenting them. */
export function alignSelection(document: DiagramDocument, ids: readonly string[], alignment: Alignment): DiagramDocument | undefined {
  const nodes = editableSelection(document, ids, 2);
  if (!nodes) return undefined;
  const rects = nodes.map((node) => nodeRect(document, node));
  const left = Math.min(...rects.map((rect) => rect.x));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.y));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  const center = (left + right) / 2;
  const middle = (top + bottom) / 2;
  const positions: Record<string, Point> = {};
  nodes.forEach((node, index) => {
    const rect = rects[index]!;
    positions[node.id] = {
      x: alignment === 'left' ? left : alignment === 'center' ? center - rect.width / 2 : alignment === 'right' ? right - rect.width : rect.x,
      y: alignment === 'top' ? top : alignment === 'middle' ? middle - rect.height / 2 : alignment === 'bottom' ? bottom - rect.height : rect.y,
    };
  });
  return reposition(document, nodes, positions);
}

/** Distributes three or more unlocked siblings with equal gaps while preserving outer nodes. */
export function distributeSelection(document: DiagramDocument, ids: readonly string[], direction: Distribution): DiagramDocument | undefined {
  const nodes = editableSelection(document, ids, 3);
  if (!nodes) return undefined;
  const ordered = nodes.map((node) => ({ node, rect: nodeRect(document, node) })).sort((a, b) => direction === 'horizontal' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y);
  const first = ordered[0]!; const last = ordered.at(-1)!;
  const totalSize = ordered.reduce((sum, entry) => sum + (direction === 'horizontal' ? entry.rect.width : entry.rect.height), 0);
  const span = direction === 'horizontal' ? last.rect.right - first.rect.x : last.rect.bottom - first.rect.y;
  const gap = (span - totalSize) / (ordered.length - 1);
  let cursor = direction === 'horizontal' ? first.rect.x : first.rect.y;
  const positions: Record<string, Point> = {};
  ordered.forEach(({ node, rect }) => {
    positions[node.id] = direction === 'horizontal' ? { x: cursor, y: rect.y } : { x: rect.x, y: cursor };
    cursor += (direction === 'horizontal' ? rect.width : rect.height) + gap;
  });
  return reposition(document, nodes, positions);
}

/** Returns the smallest boundary size that contains all descendants with padding. */
export function minimumBoundarySize(document: DiagramDocument, boundaryId: string): Size {
  const boundary = document.nodesById[boundaryId];
  if (!boundary || boundary.kind !== 'boundary') return BOUNDARY_MIN_SIZE;
  const origin = getAbsolutePosition(document, boundaryId);
  const isDescendant = (node: DiagramNode): boolean => {
    let parentId = node.physicalParentId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (parentId === boundaryId) return true;
      visited.add(parentId);
      parentId = document.nodesById[parentId]?.physicalParentId;
    }
    return false;
  };
  const descendants = Object.values(document.nodesById).filter(isDescendant);
  return {
    width: Math.max(BOUNDARY_MIN_SIZE.width, ...descendants.map((node) => nodeRect(document, node).right - origin.x + BOUNDARY_PADDING)),
    height: Math.max(BOUNDARY_MIN_SIZE.height, ...descendants.map((node) => nodeRect(document, node).bottom - origin.y + BOUNDARY_PADDING)),
  };
}

export function constrainBoundarySize(document: DiagramDocument, nodeId: string, requested: Size): Size {
  const minimum = minimumBoundarySize(document, nodeId);
  return { width: Math.max(requested.width, minimum.width), height: Math.max(requested.height, minimum.height) };
}

/** Moves selected unlocked nodes by one keyboard delta. */
export function nudgeSelection(document: DiagramDocument, ids: readonly string[], delta: Point): DiagramDocument {
  const nodesById = { ...document.nodesById };
  let changed = false;
  for (const id of ids) {
    const node = nodesById[id];
    if (!node || node.locked) continue;
    nodesById[id] = { ...node, position: { x: node.position.x + delta.x, y: node.position.y + delta.y } };
    changed = true;
  }
  return changed ? { ...document, nodesById } : document;
}

/** Reorders one unlocked node inside its physical sibling scope using dense z-indices. */
export function reorderNode(document: DiagramDocument, nodeId: string, operation: 'back' | 'backward' | 'forward' | 'front'): DiagramDocument | undefined {
  const node = document.nodesById[nodeId];
  if (!node || node.locked) return undefined;
  const siblings = document.nodeOrder.map((id) => document.nodesById[id]).filter((candidate): candidate is DiagramNode => candidate !== undefined).filter((candidate) => candidate.physicalParentId === node.physicalParentId).sort((a, b) => a.zIndex - b.zIndex || document.nodeOrder.indexOf(a.id) - document.nodeOrder.indexOf(b.id));
  const index = siblings.findIndex((candidate) => candidate.id === nodeId);
  if (index < 0) return undefined;
  const target = operation === 'back' ? 0 : operation === 'front' ? siblings.length - 1 : operation === 'backward' ? Math.max(0, index - 1) : Math.min(siblings.length - 1, index + 1);
  if (target === index && siblings.every((item, itemIndex) => item.zIndex === itemIndex)) return undefined;
  siblings.splice(index, 1); siblings.splice(target, 0, node);
  const nodesById = { ...document.nodesById };
  siblings.forEach((item, itemIndex) => { nodesById[item.id] = { ...item, zIndex: itemIndex }; });
  return { ...document, nodesById };
}

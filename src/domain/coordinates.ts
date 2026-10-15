/**
 * @file Diagram coordinate conversion helpers.
 * @module domain/coordinates
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file resolves absolute positions, relative positions, reparenting coordinates, and parent-first ordering.
 */
import type { DiagramDocument, DiagramNode, Point } from './types';

/** Resolves a node position into root canvas coordinates. */
export function getAbsolutePosition(document: DiagramDocument, nodeId: string): Point {
  const visited = new Set<string>();
  const initial = document.nodesById[nodeId];
  if (!initial) return { x: 0, y: 0 };
  let node: DiagramNode = initial;
  let x = node.position.x;
  let y = node.position.y;
  while (node.physicalParentId) {
    if (visited.has(node.id)) break;
    visited.add(node.id);
    const parent: DiagramNode | undefined = document.nodesById[node.physicalParentId];
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    node = parent;
  }
  return { x, y };
}

/** Converts a root canvas point into coordinates relative to a parent. */
export function absoluteToRelative(document: DiagramDocument, absolute: Point, parentId?: string): Point {
  if (!parentId) return absolute;
  const parentAbsolute = getAbsolutePosition(document, parentId);
  return { x: absolute.x - parentAbsolute.x, y: absolute.y - parentAbsolute.y };
}

/** Calculates the relative position that preserves a node absolute location. */
export function reparentPosition(document: DiagramDocument, nodeId: string, newParentId?: string): Point {
  return absoluteToRelative(document, getAbsolutePosition(document, nodeId), newParentId);
}

/** Sorts node identifiers so physical parents render before children. */
export function sortParentBeforeChild(document: DiagramDocument, ids = document.nodeOrder): string[] {
  const depth = (id: string): number => {
    let current = document.nodesById[id];
    let value = 0;
    const visited = new Set<string>();
    while (current?.physicalParentId && !visited.has(current.id)) {
      visited.add(current.id);
      value += 1;
      current = document.nodesById[current.physicalParentId];
    }
    return value;
  };
  return [...ids].sort((a, b) => depth(a) - depth(b) || ids.indexOf(a) - ids.indexOf(b));
}

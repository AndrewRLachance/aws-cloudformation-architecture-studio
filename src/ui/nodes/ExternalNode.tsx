/**
 * @file External reference node renderer.
 * @module ui/nodes/ExternalNode
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders unresolved exports, ARNs, parameters, resources, principals, and template URL references.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ArchitectureFlowNode } from '../../reactflow/adapters';
import { NodeAnnotations } from './NodeAnnotations';

/** Renders a React Flow node for an unresolved external reference. */
export function ExternalNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const node = data.domain;
  if (node.kind !== 'external-reference') return null;
  return <article className={`architecture-node external-node ${selected ? 'is-selected' : ''}`} data-testid={`node-${node.id}`}><span className="node-kicker">External reference</span><strong>{node.name}</strong><small>{node.referenceType}</small><NodeAnnotations node={node} /><Handle type="target" position={Position.Left} id="in" /><Handle type="source" position={Position.Right} id="out" /><Handle type="target" position={Position.Top} id="north" /><Handle type="source" position={Position.Bottom} id="south" /></article>;
}

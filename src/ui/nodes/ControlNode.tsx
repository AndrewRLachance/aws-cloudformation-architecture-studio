/**
 * @file Governance control node renderer.
 * @module ui/nodes/ControlNode
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders security and governance control nodes with React Flow connection handles.
 */
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ArchitectureFlowNode } from '../../reactflow/adapters';
import { NodeAnnotations } from './NodeAnnotations';

/** Renders a React Flow node for a governance control. */
export function ControlNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const node = data.domain;
  if (node.kind !== 'control') return null;
  return <article className={`architecture-node control-node ${selected ? 'is-selected' : ''}`} data-testid={`node-${node.id}`}><span className="node-kicker">Governance control</span><strong>{node.name}</strong><small>{node.controlType}</small><NodeAnnotations node={node} /><Handle type="target" position={Position.Left} id="in" /><Handle type="source" position={Position.Right} id="out" /><Handle type="target" position={Position.Top} id="north" /><Handle type="source" position={Position.Bottom} id="south" /></article>;
}

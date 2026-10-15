/**
 * @file Physical boundary node renderer.
 * @module ui/nodes/BoundaryNode
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders resizable organization, account, Region, VPC, Availability Zone, and subnet boundaries.
 */
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import type { ArchitectureFlowNode } from '../../reactflow/adapters';
import { useDiagramStore } from '../../store/useDiagramStore';
import { minimumBoundarySize } from '../../domain/editing';
import { NodeAnnotations } from './NodeAnnotations';

/** Renders a resizable React Flow node for a physical boundary. */
export function BoundaryNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const node = data.domain;
  const readOnly = useDiagramStore((state) => state.readOnly);
  const document = useDiagramStore((state) => state.document);
  if (node.kind !== 'boundary') return null;
  return (
    <section className={`architecture-node boundary-node boundary-${node.boundaryType} ${selected ? 'is-selected' : ''}`} data-testid={`node-${node.id}`} aria-label={`${node.name} boundary`}>
      <NodeResizer minWidth={minimumBoundarySize(document, node.id).width} minHeight={minimumBoundarySize(document, node.id).height} isVisible={selected && !readOnly && !node.locked} />
      <div className="boundary-header">
        <span className="node-kicker">{node.boundaryType.replaceAll('-', ' ')}</span>
        <strong>{node.name}</strong>
        <span className="node-flags">{node.locked ? 'Locked' : ''}{node.pinned ? ' · Pinned' : ''}</span>
      </div>
      {node.cidr && <span className="boundary-cidr">{node.cidr}</span>}
      <NodeAnnotations node={node} />
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
    </section>
  );
}

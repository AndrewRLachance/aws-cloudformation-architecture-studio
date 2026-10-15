import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { ArchitectureFlowNode } from '../../reactflow/adapters';
import { useDiagramStore } from '../../store/useDiagramStore';

export function TextNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const node = data.domain; const readOnly = useDiagramStore((state) => state.readOnly);
  if (node.kind !== 'text') return null;
  return <article className={`architecture-node text-node ${selected ? 'is-selected' : ''}`} data-testid={`node-${node.id}`} style={{ color: node.style.color, background: node.style.backgroundColor ?? 'transparent', textAlign: node.style.alignment, fontSize: node.style.fontSize, fontWeight: node.style.fontWeight }}>
    <NodeResizer minWidth={80} minHeight={32} isVisible={selected && !readOnly && !node.locked} />
    <div>{node.text}</div>
  </article>;
}

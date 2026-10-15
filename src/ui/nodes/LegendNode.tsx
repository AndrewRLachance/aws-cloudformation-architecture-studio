import { NodeResizer, type NodeProps } from '@xyflow/react';
import type { ArchitectureFlowNode } from '../../reactflow/adapters';
import { useDiagramStore } from '../../store/useDiagramStore';

export function LegendNode({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const node = data.domain; const readOnly = useDiagramStore((state) => state.readOnly);
  if (node.kind !== 'legend') return null;
  const entries: readonly { readonly id?: string; readonly label: string; readonly color: string; readonly symbol?: string; readonly description?: string }[] = node.mode === 'automatic' ? data.legendEntries ?? [] : node.entries;
  return <aside className={`architecture-node legend-node ${selected ? 'is-selected' : ''}`} data-testid={`node-${node.id}`}>
    <NodeResizer minWidth={160} minHeight={90} isVisible={selected && !readOnly && !node.locked} />
    <strong>{node.title}</strong><small>{node.mode}</small>
    <ul>{entries.map((entry, index) => <li key={entry.id ?? `${entry.label}-${index}`}><span className="legend-swatch" style={{ background: entry.color }}>{entry.symbol ?? ''}</span><span>{entry.label}</span>{entry.description && <small>{entry.description}</small>}</li>)}</ul>
  </aside>;
}

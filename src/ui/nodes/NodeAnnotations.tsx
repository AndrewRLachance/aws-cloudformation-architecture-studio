import type { DiagramNode } from '../../domain/types';

export function NodeAnnotations({ node }: { readonly node: DiagramNode }) {
  if (node.annotations.length === 0) return null;
  return <div className="node-annotations" aria-label={`${node.annotations.length} annotations`}>{node.annotations.map((annotation) => <span key={annotation.id} className={`annotation annotation-${annotation.tone}`} style={{ borderColor: annotation.color }} title={annotation.body}>{annotation.label}</span>)}</div>;
}

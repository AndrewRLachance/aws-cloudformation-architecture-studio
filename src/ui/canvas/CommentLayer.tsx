import type { DiagramComment, DiagramDocument } from '../../domain/types';
import { getAbsolutePosition } from '../../domain/coordinates';

function point(document: DiagramDocument, comment: DiagramComment) {
  if (comment.target.kind === 'canvas') return comment.target.position;
  const node = document.nodesById[comment.target.nodeId]; const origin = getAbsolutePosition(document, comment.target.nodeId);
  return { x: origin.x + (node?.size.width ?? 0) + comment.target.offset.x, y: origin.y + comment.target.offset.y };
}

export function CommentLayer({ document, showResolved, onUpdate, onDelete }: { readonly document: DiagramDocument; readonly showResolved: boolean; readonly onUpdate: (id: string, patch: Partial<DiagramComment>) => void; readonly onDelete: (id: string) => void }) {
  if (!document.visibleLayers['review-comments']) return null;
  return <div className="comment-layer" data-export-exclude="true">{document.commentOrder.map((id) => document.commentsById[id]).filter((comment): comment is DiagramComment => Boolean(comment && (!comment.resolved || showResolved))).map((comment) => {
    const position = point(document, comment); const left = position.x * document.viewport.zoom + document.viewport.x; const top = position.y * document.viewport.zoom + document.viewport.y;
    const move = (dx: number, dy: number) => onUpdate(comment.id, { target: comment.target.kind === 'canvas' ? { ...comment.target, position: { x: comment.target.position.x + dx, y: comment.target.position.y + dy } } : { ...comment.target, offset: { x: comment.target.offset.x + dx, y: comment.target.offset.y + dy } } });
    return <article key={comment.id} className={`comment-card ${comment.resolved ? 'is-resolved' : ''}`} style={{ left, top }}><p>{comment.message}</p><div><button type="button" onClick={() => { const message = globalThis.prompt?.('Edit comment', comment.message); if (message?.trim()) onUpdate(comment.id, { message: message.trim() }); }}>Edit</button><button type="button" onClick={() => onUpdate(comment.id, { resolved: !comment.resolved })}>{comment.resolved ? 'Reopen' : 'Resolve'}</button><button type="button" onClick={() => onDelete(comment.id)}>Delete</button></div><div className="comment-move" aria-label="Move comment"><button onClick={() => move(-8, 0)}>←</button><button onClick={() => move(0, -8)}>↑</button><button onClick={() => move(0, 8)}>↓</button><button onClick={() => move(8, 0)}>→</button></div></article>;
  })}</div>;
}

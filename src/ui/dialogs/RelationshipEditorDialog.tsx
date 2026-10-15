/**
 * @file Manual semantic relationship creation and editing dialog.
 * @module ui/dialogs/RelationshipEditorDialog
 */
import { useEffect, useRef, useState } from 'react';
import type { DiagramEdge, RelationshipType } from '../../domain/types';
import { uniqueId } from '../../domain/ids';
import { useDiagramStore } from '../../store/useDiagramStore';

const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'associated-with','depends-on','references-resource','network-traffic','imports-cloudformation-output','assumes-role','trusts-principal','permits-access','denies-access','routes-through','shares-through-aws-ram','publishes-event','subscribes-to-event','reads-from','writes-to','replicates-to','deploys-to','stackset-manages-stack-instance','nested-stack','external-unresolved-reference',
];

export interface RelationshipEditorDialogProps {
  readonly open: boolean;
  readonly sourceId: string;
  readonly targetId: string;
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
  readonly edgeId?: string;
  readonly onClose: () => void;
}

/** Collects semantic and optional CloudFormation generation metadata before committing an edge. */
export function RelationshipEditorDialog({ open, sourceId, targetId, sourceHandle, targetHandle, edgeId, onClose }: RelationshipEditorDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const document = useDiagramStore((state) => state.document);
  const addEdge = useDiagramStore((state) => state.addEdge);
  const updateEdge = useDiagramStore((state) => state.updateEdge);
  const existing = edgeId ? document.edgesById[edgeId] : undefined;
  const [relationshipType, setRelationshipType] = useState<RelationshipType>(existing?.relationshipType ?? 'associated-with');
  const [direction, setDirection] = useState<DiagramEdge['direction']>(existing?.direction ?? 'forward');
  const [label, setLabel] = useState(existing?.label ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [protocol, setProtocol] = useState(existing?.protocol ?? '');
  const [port, setPort] = useState(existing?.port ?? '');
  const [sourcePropertyPath, setSourcePropertyPath] = useState(existing?.sourcePropertyPath ?? '');
  useEffect(() => { if (open) dialogRef.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus(); }, [open]);
  if (!open) return null;
  const source = document.nodesById[sourceId]; const target = document.nodesById[targetId];
  const duplicate = document.edgeOrder.map((id) => document.edgesById[id]).some((edge) => edge && edge.id !== edgeId && edge.source === sourceId && edge.target === targetId && edge.relationshipType === relationshipType && edge.direction === direction && (edge.label ?? '') === label.trim() && (edge.description ?? '') === description.trim() && (edge.protocol ?? '') === protocol.trim() && (edge.port ?? '') === port.trim() && (edge.sourcePropertyPath ?? '') === sourcePropertyPath.trim());
  const invalidPath = Boolean(sourcePropertyPath.trim()) && !/^Resources\.[A-Za-z][A-Za-z0-9]*\.Properties(?:\.|$)/.test(sourcePropertyPath.trim());
  const save = (): void => {
    if (!source || !target || sourceId === targetId || duplicate || invalidPath) return;
    const patch: DiagramEdge = {
      id: existing?.id ?? uniqueId('edge'), source: sourceId, target: targetId, relationshipType, direction, metadata: existing?.metadata ?? {}, validationStatus: 'valid',
      ...(sourceHandle ? { sourceHandle } : existing?.sourceHandle ? { sourceHandle: existing.sourceHandle } : {}), ...(targetHandle ? { targetHandle } : existing?.targetHandle ? { targetHandle: existing.targetHandle } : {}),
      ...(label.trim() ? { label: label.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(protocol.trim() ? { protocol: protocol.trim() } : {}), ...(port.trim() ? { port: port.trim() } : {}), ...(sourcePropertyPath.trim() ? { sourcePropertyPath: sourcePropertyPath.trim() } : {}),
    };
    if (existing) updateEdge(existing.id, patch, 'edit-relationship'); else addEdge(patch);
    onClose();
  };
  return <div className="modal-backdrop relationship-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="relationship-dialog" role="dialog" aria-modal="true" aria-labelledby="relationship-dialog-title" onKeyDown={(event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Tab') {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
      if (!focusable.length) return;
      const index = focusable.indexOf(globalThis.document.activeElement as HTMLElement); const target = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index >= focusable.length - 1 ? 0 : index + 1);
      event.preventDefault(); focusable[target]?.focus();
    }
  }}>
    <div className="dialog-header"><div><span className="eyebrow">Semantic connection</span><h2 id="relationship-dialog-title">{existing ? 'Edit' : 'Create'} relationship</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close relationship dialog">×</button></div>
    <div className="dialog-body"><p><strong>{source?.name ?? sourceId}</strong> → <strong>{target?.name ?? targetId}</strong></p><div className="form-grid">
      <label>Relationship type<select value={relationshipType} onChange={(event) => setRelationshipType(event.target.value as RelationshipType)}>{RELATIONSHIP_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Direction<select value={direction} onChange={(event) => setDirection(event.target.value as DiagramEdge['direction'])}><option value="forward">Forward</option><option value="reverse">Reverse</option><option value="bidirectional">Bidirectional</option><option value="none">None</option></select></label>
      <label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Protocol<input value={protocol} onChange={(event) => setProtocol(event.target.value)} /></label><label>Port<input value={port} onChange={(event) => setPort(event.target.value)} /></label>
    </div><label>CloudFormation source property path<input value={sourcePropertyPath} onChange={(event) => setSourcePropertyPath(event.target.value)} placeholder={`Resources.${source?.sourceLogicalId ?? 'LogicalId'}.Properties.Property`} /><small>Optional. Leave blank for a visual-only relationship.</small></label>
      {sourceId === targetId && <p className="error-note">A relationship cannot connect a node to itself.</p>}{duplicate && <p className="error-note">This relationship already exists.</p>}{invalidPath && <p className="error-note">Use a path beginning with Resources.&lt;LogicalId&gt;.Properties.</p>}
    </div><footer className="dialog-footer"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" onClick={save} disabled={!source || !target || sourceId === targetId || duplicate || invalidPath}>Save relationship</button></footer>
  </section></div>;
}

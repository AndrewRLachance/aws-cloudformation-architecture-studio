/**
 * @file Application header and document actions.
 * @module ui/components/Header
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders save/load/import/export actions, undo/redo controls, layer toggles, and autosave status.
 */
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { createGenerationZip, generateCloudFormation, GenerationValidationError } from '../../cloudformation/generator';
import { parseDiagramDocument } from '../../domain/schema';
import type { LayerId, ViewMode } from '../../domain/types';
import { LocalStorageDiagramRepository, serializeDocument } from '../../persistence/repository';
import { useDiagramStore } from '../../store/useDiagramStore';
import { downloadBlob, downloadText } from '../../utils/download';
import { ImportCloudFormationDialog } from '../dialogs/ImportCloudFormationDialog';
import { ExportDiagramDialog } from '../dialogs/ExportDiagramDialog';
import { uniqueId } from '../../domain/ids';

/** Repository instance used by explicit save and load actions. */
const repository = new LocalStorageDiagramRepository();
/** Human-readable labels for layer visibility controls. */
const LAYER_LABELS: Readonly<Record<LayerId, string>> = {
  'administrative-boundaries': 'Administrative boundaries', 'network-boundaries': 'Network boundaries', 'aws-resources': 'AWS resources', 'stack-overlays': 'Stack overlays', 'stackset-overlays': 'StackSet overlays', 'stack-instance-overlays': 'Stack-instance overlays', 'logical-overlays': 'Logical overlays', 'iam-governance': 'IAM and governance', 'security-groups': 'Security groups', 'network-traffic': 'Network traffic', 'deployment-dependencies': 'Deployment dependencies', 'data-flow': 'Data flow', 'external-references': 'External references', 'import-diagnostics': 'Import diagnostics', 'labels-metadata': 'Labels and metadata', 'review-comments': 'Review comments',
};

/** Renders document actions, export tools, layer controls, and status. */
export function Header() {
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [status, setStatus] = useState('');
  const diagramInput = useRef<HTMLInputElement>(null);
  const { document, undoCount, redoCount, autosave, readOnly } = useDiagramStore(useShallow((state) => ({ document: state.document, undoCount: state.undoStack.length, redoCount: state.redoStack.length, autosave: state.autosave, readOnly: state.readOnly })));
  const actions = useDiagramStore(useShallow((state) => ({ newDocument: state.newDocument, loadDocument: state.loadDocument, undo: state.undo, redo: state.redo, setViewMode: state.setViewMode, setLayerVisible: state.setLayerVisible, setReadOnly: state.setReadOnly, setAutosave: state.setAutosave, setOperationProgress: state.setOperationProgress })));

  const save = async (): Promise<void> => {
    actions.setAutosave({ status: 'saving', savedRevision: autosave.savedRevision });
    try { await repository.save(document); actions.setAutosave({ status: 'saved', savedRevision: document.revision.number }); setStatus('Saved locally.'); }
    catch (error) { actions.setAutosave({ status: 'error', savedRevision: autosave.savedRevision, message: error instanceof Error ? error.message : String(error) }); }
  };
  const load = async (): Promise<void> => {
    try { const restored = await repository.load(); if (restored) { actions.loadDocument(restored); setStatus('Local save loaded.'); } else setStatus('No local save exists.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };
  const importDiagram = async (file: File): Promise<void> => {
    try { actions.loadDocument(parseDiagramDocument(JSON.parse(await file.text()) as unknown)); setStatus(`${file.name} imported.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  };
  const exportCloudFormation = async (): Promise<void> => {
    const operationId = uniqueId('operation');
    try {
      actions.setOperationProgress({ id: operationId, kind: 'export', status: 'running', phase: 'generate', completed: 0, total: 1, percent: 0, message: 'Generating CloudFormation templates.' });
      const generated = generateCloudFormation(document);
      if (!generated.canExport) throw new GenerationValidationError(generated.validationIssues);
      if (generated.templates.length === 1) {
        const template = generated.templates[0];
        if (template) downloadText(template.filename.endsWith('.json') ? template.json : template.yaml, template.filename, template.filename.endsWith('.json') ? 'application/json' : 'application/yaml');
      } else {
        const blob = await createGenerationZip(document, (completed, total, message) => actions.setOperationProgress({ id: operationId, kind: 'export', status: 'running', phase: 'zip', completed, total, percent: Math.round(completed / total * 100), message }));
        downloadBlob(blob, 'cloudformation-templates.zip');
      }
      actions.setOperationProgress({ id: operationId, kind: 'export', status: 'complete', phase: 'complete', completed: 1, total: 1, percent: 100, message: 'CloudFormation export ready.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.setOperationProgress({ id: operationId, kind: 'export', status: 'error', phase: 'failed', completed: 0, total: 1, message });
      setStatus(message);
    }
  };
  const exportBundle = async (): Promise<void> => {
    const operationId = uniqueId('operation');
    try {
      const blob = await createGenerationZip(document, (completed, total, message) => actions.setOperationProgress({ id: operationId, kind: 'export', status: 'running', phase: 'zip', completed, total, percent: Math.round(completed / total * 100), message }));
      downloadBlob(blob, 'architecture-bundle.zip');
      actions.setOperationProgress({ id: operationId, kind: 'export', status: 'complete', phase: 'complete', completed: 1, total: 1, percent: 100, message: 'Architecture ZIP bundle exported.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.setOperationProgress({ id: operationId, kind: 'export', status: 'error', phase: 'failed', completed: 0, total: 1, message });
      setStatus(message);
    }
  };
  return (
    <>
      <header className="app-header">
        <div className="brand"><div className="brand-mark" aria-hidden="true">CFN</div><div><span>AWS Architecture</span><strong>CloudFormation Studio</strong></div></div>
        <nav className="header-actions" aria-label="Document actions">
          <button type="button" onClick={actions.newDocument}>New</button>
          <button type="button" onClick={() => void save()}>Save</button>
          <button type="button" onClick={() => void load()}>Load</button>
          <button type="button" onClick={() => diagramInput.current?.click()}>Import Diagram JSON</button>
          <button type="button" className="accent-button" onClick={() => setImportOpen(true)}>Import CloudFormation</button>
          <input ref={diagramInput} hidden type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importDiagram(file); event.target.value = ''; }} />
          <div className="menu-wrap"><details><summary>Export</summary><div className="header-menu"><button type="button" onClick={() => downloadText(serializeDocument(document), 'architecture-diagram.json', 'application/json')}>Export Diagram JSON</button><button type="button" onClick={() => void exportCloudFormation()}>Export CloudFormation</button><button type="button" onClick={() => void exportBundle()}>Export ZIP Bundle</button><button type="button" onClick={() => setExportOpen(true)}>Export Diagram…</button></div></details></div>
          <span className="header-divider" />
          <button type="button" onClick={actions.undo} disabled={undoCount === 0} aria-label="Undo">↶</button>
          <button type="button" onClick={actions.redo} disabled={redoCount === 0} aria-label="Redo">↷</button>
        </nav>
        <div className="header-controls">
          <label className="compact-select">View<select aria-label="View mode" value={document.currentViewMode} onChange={(event) => actions.setViewMode(event.target.value as ViewMode)}><option value="infrastructure">Infrastructure</option><option value="deployment">Deployment</option><option value="security">Security</option><option value="cloudformation-source">CloudFormation source</option></select></label>
          <details className="layer-menu"><summary>Layers</summary><div>{Object.entries(LAYER_LABELS).map(([layer, label]) => <label key={layer}><input type="checkbox" checked={document.visibleLayers[layer as LayerId]} onChange={(event) => actions.setLayerVisible(layer as LayerId, event.target.checked)} />{label}</label>)}</div></details>
          <button type="button" className={readOnly ? 'is-active' : ''} onClick={() => actions.setReadOnly(!readOnly)}>{readOnly ? 'Exit presentation' : 'Present'}</button>
          <span className={`autosave-status status-${autosave.status}`}>{autosave.status === 'saved' ? `Saved r${autosave.savedRevision}` : autosave.status}</span>
        </div>
      </header>
      {(status || autosave.message) && <div className="header-notice" role="status">{status || autosave.message}</div>}
      <ImportCloudFormationDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <ExportDiagramDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
  );
}

/**
 * @file Full-diagram PNG, SVG, and tiled PDF export dialog.
 * @module ui/dialogs/ExportDiagramDialog
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { DiagramExportOptions } from '../../domain/types';
import { uniqueId } from '../../domain/ids';
import { calculateCaptureGeometry, calculatePdfTiles, exportDiagram } from '../../export/diagramExport';
import { useDiagramStore } from '../../store/useDiagramStore';
import { downloadBlob } from '../../utils/download';

const DEFAULT_OPTIONS: DiagramExportOptions = { format: 'png', scope: 'full-diagram', scale: 2, transparent: false, backgroundColor: '#f4f7fb', padding: 32, pageSize: 'letter', orientation: 'auto', tileOverlapInches: 0.25 };

export interface ExportDiagramDialogProps { readonly open: boolean; readonly onClose: () => void; }

/** Renders export options, resolution/page previews, and progress-aware download generation. */
export function ExportDiagramDialog({ open, onClose }: ExportDiagramDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const { getNodes } = useReactFlow();
  const setOperationProgress = useDiagramStore((state) => state.setOperationProgress);
  const operation = useDiagramStore((state) => state.operationProgress);
  const [options, setOptions] = useState<DiagramExportOptions>(DEFAULT_OPTIONS);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const viewport = open ? document.querySelector<HTMLElement>('#canvas-surface .react-flow__viewport') : null;
  const geometry = useMemo(() => viewport ? calculateCaptureGeometry(viewport, getNodes(), options) : undefined, [getNodes, options, viewport]);
  const tiles = geometry && options.format === 'pdf' ? calculatePdfTiles(geometry.width, geometry.height, options) : undefined;
  useEffect(() => { if (open) dialogRef.current?.querySelector<HTMLElement>('button, input, select')?.focus(); }, [open]);
  if (!open) return null;
  const run = async (): Promise<void> => {
    if (!viewport) { setError('The diagram viewport is not available.'); return; }
    const id = uniqueId('operation'); setRunning(true); setError('');
    try {
      const result = await exportDiagram(viewport, getNodes(), options, (phase, completed, total, message) => setOperationProgress({ id, kind: 'export', status: 'running', phase, completed, total, percent: total ? Math.round(completed / total * 100) : undefined, message }));
      downloadBlob(result.blob, result.filename);
      setOperationProgress({ id, kind: 'export', status: 'complete', phase: 'complete', completed: 1, total: 1, percent: 100, message: `${result.filename} exported.` });
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught); setError(message); setOperationProgress({ id, kind: 'export', status: 'error', phase: 'failed', completed: 0, total: 1, message });
    } finally { setRunning(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (!running && event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && !running) onClose();
    if (event.key === 'Tab') {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement); const target = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index >= focusable.length - 1 ? 0 : index + 1);
      event.preventDefault(); focusable[target]?.focus();
    }
  }}>
    <div className="dialog-header"><div><span className="eyebrow">Diagram output</span><h2 id="export-dialog-title">Export diagram</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close export dialog">×</button></div>
    <div className="dialog-body"><fieldset className="choice-grid"><legend>Format</legend>{(['png','svg','pdf'] as const).map((format) => <label className="choice-card" key={format}><input type="radio" name="export-format" checked={options.format === format} onChange={() => setOptions({ ...options, format })} /><strong>{format.toUpperCase()}</strong><span>{format === 'pdf' ? 'Tiled printable pages' : format === 'svg' ? 'Scalable vector output' : 'High-resolution raster output'}</span></label>)}</fieldset>
      <div className="form-grid"><label>Capture<select value={options.scope} onChange={(event) => setOptions({ ...options, scope: event.target.value as DiagramExportOptions['scope'] })}><option value="full-diagram">Full diagram</option><option value="current-viewport">Current viewport</option></select></label><label>Scale<select value={options.scale} onChange={(event) => setOptions({ ...options, scale: Number(event.target.value) as DiagramExportOptions['scale'] })}><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label><label>Padding<input type="number" min="0" max="256" value={options.padding} onChange={(event) => setOptions({ ...options, padding: Number(event.target.value) })} /></label>{options.format !== 'pdf' && <label>Background<select value={options.transparent ? 'transparent' : 'solid'} onChange={(event) => setOptions({ ...options, transparent: event.target.value === 'transparent' })}><option value="solid">Solid</option><option value="transparent">Transparent</option></select></label>}</div>
      {options.format === 'pdf' && <div className="form-grid"><label>Page size<select value={options.pageSize} onChange={(event) => setOptions({ ...options, pageSize: event.target.value as DiagramExportOptions['pageSize'] })}><option value="letter">Letter</option><option value="a4">A4</option><option value="a3">A3</option></select></label><label>Orientation<select value={options.orientation} onChange={(event) => setOptions({ ...options, orientation: event.target.value as DiagramExportOptions['orientation'] })}><option value="auto">Automatic</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label><label>Tile overlap<input type="number" min="0" max="1" step="0.05" value={options.tileOverlapInches} onChange={(event) => setOptions({ ...options, tileOverlapInches: Number(event.target.value) })} /> inches</label></div>}
      {geometry && <div className="summary-strip"><span>{Math.ceil(geometry.width)} × {Math.ceil(geometry.height)} diagram px</span>{options.format !== 'svg' && <span>{Math.ceil(geometry.width * options.scale)} × {Math.ceil(geometry.height * options.scale)} output px</span>}{tiles && <span>{tiles.columns} × {tiles.rows} = {tiles.columns * tiles.rows} pages</span>}</div>}
      {error && <p className="error-note" role="alert">{error}</p>}
      {operation?.kind === 'export' && <div className={`operation-status status-${operation.status}`} role="status" aria-live="polite"><progress max={operation.total || 1} value={operation.completed} aria-label="Diagram export progress" /><strong>{operation.phase}</strong><span>{operation.percent !== undefined ? `${operation.percent}%` : `${operation.completed} of ${operation.total}`}</span><p>{operation.message}</p></div>}
    </div><footer className="dialog-footer"><button type="button" onClick={onClose} disabled={running}>Cancel</button><button type="button" className="primary-button" onClick={() => void run()} disabled={running}>{running ? 'Exporting…' : `Export ${options.format.toUpperCase()}`}</button></footer>
  </section></div>;
}

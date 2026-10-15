/**
 * @file Editor shell layout and panel orchestration.
 * @module app/Editor
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file composes the header, palette, canvas, inspector, diagnostics panel, and accessible live status region.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Header } from '../ui/components/Header';
import { Palette } from '../ui/palette/Palette';
import { ArchitectureCanvas } from '../ui/canvas/ArchitectureCanvas';
import { Inspector } from '../ui/inspector/Inspector';
import { BottomPanel } from '../ui/components/BottomPanel';
import { useDiagramStore } from '../store/useDiagramStore';

/** Minimum expanded inspector width in pixels. */
const MIN_INSPECTOR = 240;
/** Maximum expanded inspector width in pixels. */
const MAX_INSPECTOR = 700;

/** Composes the editor shell, panels, resizer, and live status region. */
export function Editor() {
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [bottomCollapsed, setBottomCollapsed] = useState(true);
  const [inspectorWidth, setInspectorWidth] = useState(330);
  const dragging = useRef(false);
  const announcement = useDiagramStore((state) => state.announcement);
  const sourceNavigation = useDiagramStore((state) => state.sourceNavigation);
  const clearSourceNavigation = useDiagramStore((state) => state.clearSourceNavigation);
  const effectiveInspectorCollapsed = inspectorCollapsed && !sourceNavigation;
  useEffect(() => {
    const move = (event: PointerEvent): void => {
      if (!dragging.current || effectiveInspectorCollapsed) return;
      const width = Math.min(MAX_INSPECTOR, Math.max(MIN_INSPECTOR, window.innerWidth - event.clientX));
      setInspectorWidth(width);
    };
    const up = (): void => { dragging.current = false; document.body.classList.remove('is-resizing'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [effectiveInspectorCollapsed]);

  const resizeBy = (delta: number): void => setInspectorWidth((width) => Math.min(MAX_INSPECTOR, Math.max(MIN_INSPECTOR, width + delta)));
  const style = { '--inspector-expanded-width': `${inspectorWidth}px` } as CSSProperties;
  return <div className={`editor-shell ${paletteCollapsed ? 'palette-collapsed' : ''} ${effectiveInspectorCollapsed ? 'inspector-collapsed' : ''} ${bottomCollapsed ? 'bottom-collapsed' : ''}`} style={style}>
    <Header />
    <Palette collapsed={paletteCollapsed} onToggle={() => setPaletteCollapsed((value) => !value)} />
    <ArchitectureCanvas />
    <div className="inspector-separator" role="separator" aria-label="Resize inspector" aria-orientation="vertical" aria-valuenow={effectiveInspectorCollapsed ? 48 : inspectorWidth} aria-valuemin={MIN_INSPECTOR} aria-valuemax={MAX_INSPECTOR} tabIndex={0}
      onPointerDown={(event) => { event.preventDefault(); dragging.current = true; document.body.classList.add('is-resizing'); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); resizeBy(16); }
        if (event.key === 'ArrowRight') { event.preventDefault(); resizeBy(-16); }
        if (event.key === 'Home') { event.preventDefault(); setInspectorWidth(MIN_INSPECTOR); }
        if (event.key === 'End') { event.preventDefault(); setInspectorWidth(MAX_INSPECTOR); }
      }} />
    <Inspector collapsed={effectiveInspectorCollapsed} onToggle={() => {
      if (sourceNavigation) { clearSourceNavigation(); setInspectorCollapsed(true); }
      else setInspectorCollapsed((value) => !value);
    }} />
    <BottomPanel collapsed={bottomCollapsed} onToggle={() => setBottomCollapsed((value) => !value)} />
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
  </div>;
}

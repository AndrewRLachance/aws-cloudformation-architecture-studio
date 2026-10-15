/**
 * @file Full-bounds PNG, SVG, and tiled PDF diagram export.
 * @module export/diagramExport
 */
import { getNodesBounds, type Node } from '@xyflow/react';
import type { DiagramExportOptions } from '../domain/types';

export interface DiagramExportResult { readonly blob: Blob; readonly filename: string; }
export type ExportProgressCallback = (phase: string, completed: number, total: number, message: string) => void;

interface CaptureGeometry {
  readonly width: number;
  readonly height: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly zoom: number;
}

const MAX_CANVAS_SIDE = 16_384;
const MAX_CANVAS_AREA = 268_435_456;

export function exportFilter(node: HTMLElement): boolean {
  return !node.closest?.('[data-export-exclude="true"]') && !node.classList?.contains('react-flow__handle') && !node.classList?.contains('react-flow__resize-control') && !node.classList?.contains('node-resizer');
}

/** Calculates full-domain or live-viewport capture geometry. */
export function calculateCaptureGeometry(viewportElement: HTMLElement, nodes: readonly Node[], options: DiagramExportOptions): CaptureGeometry {
  if (options.scope === 'current-viewport') {
    const surface = viewportElement.closest<HTMLElement>('.react-flow');
    const width = (surface?.clientWidth ?? viewportElement.clientWidth) + options.padding * 2;
    const height = (surface?.clientHeight ?? viewportElement.clientHeight) + options.padding * 2;
    const match = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(viewportElement.style.transform);
    return { width, height, translateX: Number(match?.[1] ?? 0) + options.padding, translateY: Number(match?.[2] ?? 0) + options.padding, zoom: Number(match?.[3] ?? 1) };
  }
  const bounds = getNodesBounds(nodes as Node[]);
  return { width: Math.ceil(bounds.width + options.padding * 2), height: Math.ceil(bounds.height + options.padding * 2), translateX: options.padding - bounds.x, translateY: options.padding - bounds.y, zoom: 1 };
}

function captureOptions(geometry: CaptureGeometry, options: DiagramExportOptions, translateX = geometry.translateX, translateY = geometry.translateY) {
  return {
    cacheBust: true,
    width: Math.ceil(geometry.width),
    height: Math.ceil(geometry.height),
    pixelRatio: options.scale,
    ...(options.transparent ? {} : { backgroundColor: options.backgroundColor }),
    filter: exportFilter,
    style: { width: `${geometry.width}px`, height: `${geometry.height}px`, transform: `translate(${translateX}px, ${translateY}px) scale(${geometry.zoom})`, transformOrigin: 'top left' },
  };
}

function validateRasterSize(geometry: CaptureGeometry, scale: number): void {
  const width = Math.ceil(geometry.width * scale); const height = Math.ceil(geometry.height * scale);
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_AREA) throw new Error(`The requested ${width} × ${height} raster exceeds the safe browser canvas limit. Reduce export scale or use SVG/PDF.`);
}

const PAGE_INCHES = { letter: [8.5, 11], a4: [8.2677, 11.6929], a3: [11.6929, 16.5354] } as const;

/** Returns deterministic row-major PDF tile counts for previews and tests. */
export function calculatePdfTiles(width: number, height: number, options: DiagramExportOptions): { columns: number; rows: number; pageWidthInches: number; pageHeightInches: number; contentWidthPixels: number; contentHeightPixels: number; stepX: number; stepY: number } {
  const source = PAGE_INCHES[options.pageSize];
  const landscape = options.orientation === 'landscape' || options.orientation === 'auto' && width >= height;
  const pageWidthInches = landscape ? source[1] : source[0]; const pageHeightInches = landscape ? source[0] : source[1];
  const margin = 0.35; const footer = 0.25;
  const contentWidthPixels = (pageWidthInches - margin * 2) * 96;
  const contentHeightPixels = (pageHeightInches - margin * 2 - footer) * 96;
  const overlap = options.tileOverlapInches * 96;
  const stepX = Math.max(1, contentWidthPixels - overlap); const stepY = Math.max(1, contentHeightPixels - overlap);
  return { columns: Math.max(1, Math.ceil(Math.max(0, width - overlap) / stepX)), rows: Math.max(1, Math.ceil(Math.max(0, height - overlap) / stepY)), pageWidthInches, pageHeightInches, contentWidthPixels, contentHeightPixels, stepX, stepY };
}

/** Captures the React Flow viewport without mutating its live pan/zoom state. */
export async function exportDiagram(
  viewportElement: HTMLElement,
  nodes: readonly Node[],
  options: DiagramExportOptions,
  onProgress?: ExportProgressCallback,
): Promise<DiagramExportResult> {
  const geometry = calculateCaptureGeometry(viewportElement, nodes, options);
  onProgress?.('prepare', 0, 1, `Preparing ${Math.ceil(geometry.width)} × ${Math.ceil(geometry.height)} diagram bounds.`);
  const image = await import('html-to-image');
  document.documentElement.classList.add('is-exporting');
  try {
    if (options.format === 'png') {
    validateRasterSize(geometry, options.scale);
    onProgress?.('render', 0, 1, 'Rendering PNG.');
    const blob = await image.toBlob(viewportElement, captureOptions(geometry, options));
    if (!blob) throw new Error('PNG rendering returned no image data.');
    onProgress?.('complete', 1, 1, 'PNG export ready.');
      return { blob, filename: 'architecture.png' };
    }
    if (options.format === 'svg') {
    onProgress?.('render', 0, 1, 'Rendering SVG.');
    const dataUrl = await image.toSvg(viewportElement, { ...captureOptions(geometry, options), pixelRatio: 1 });
    const blob = await fetch(dataUrl).then((response) => response.blob());
    onProgress?.('complete', 1, 1, 'SVG export ready.');
      return { blob, filename: 'architecture.svg' };
    }
    const tiles = calculatePdfTiles(geometry.width, geometry.height, options);
    const total = tiles.columns * tiles.rows;
    const { jsPDF } = await import('jspdf');
    const orientation = tiles.pageWidthInches > tiles.pageHeightInches ? 'landscape' : 'portrait';
    const pdf = new jsPDF({ orientation, unit: 'in', format: options.pageSize, compress: true });
    const margin = 0.35;
    let page = 0;
    for (let row = 0; row < tiles.rows; row += 1) {
      for (let column = 0; column < tiles.columns; column += 1) {
      if (page > 0) pdf.addPage(options.pageSize, orientation);
      page += 1;
      onProgress?.('render-page', page - 1, total, `Rendering PDF page ${page} of ${total}.`);
      const tileX = column * tiles.stepX; const tileY = row * tiles.stepY;
      const tileWidth = Math.min(tiles.contentWidthPixels, geometry.width - tileX);
      const tileHeight = Math.min(tiles.contentHeightPixels, geometry.height - tileY);
      const tileGeometry = { width: Math.max(1, tileWidth), height: Math.max(1, tileHeight), translateX: geometry.translateX - tileX, translateY: geometry.translateY - tileY, zoom: geometry.zoom };
      const dataUrl = await image.toPng(viewportElement, captureOptions(tileGeometry, { ...options, scale: options.scale === 1 ? 2 : options.scale }, tileGeometry.translateX, tileGeometry.translateY));
      pdf.addImage(dataUrl, 'PNG', margin, margin, tileWidth / 96, tileHeight / 96, undefined, 'FAST');
      pdf.setDrawColor(120); pdf.setLineWidth(0.005);
      const right = margin + tileWidth / 96; const bottom = margin + tileHeight / 96; const mark = 0.08;
      pdf.line(margin - mark, margin, margin, margin); pdf.line(margin, margin - mark, margin, margin); pdf.line(right, margin - mark, right, margin); pdf.line(right, margin, right + mark, margin); pdf.line(margin - mark, bottom, margin, bottom); pdf.line(margin, bottom, margin, bottom + mark); pdf.line(right, bottom, right + mark, bottom); pdf.line(right, bottom, right, bottom + mark);
      pdf.setFontSize(7); pdf.setTextColor(80); pdf.text(`Page ${page} of ${total} · row ${row + 1}, column ${column + 1}`, margin, tiles.pageHeightInches - 0.12);
      onProgress?.('render-page', page, total, `Rendered PDF page ${page} of ${total}.`);
      }
    }
    onProgress?.('complete', total, total, 'PDF export ready.');
    return { blob: pdf.output('blob'), filename: 'architecture.pdf' };
  } finally {
    document.documentElement.classList.remove('is-exporting');
  }
}

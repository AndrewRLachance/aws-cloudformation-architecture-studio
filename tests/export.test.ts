import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculatePdfTiles, exportDiagram, exportFilter } from '../src/export/diagramExport';
import type { DiagramExportOptions } from '../src/domain/types';

const mocks = vi.hoisted(() => ({
  toBlob: vi.fn(),
  toSvg: vi.fn(),
  toPng: vi.fn(),
  addPage: vi.fn(),
  addImage: vi.fn(),
  line: vi.fn(),
  text: vi.fn(),
  output: vi.fn(),
}));

vi.mock('html-to-image', () => ({ toBlob: mocks.toBlob, toSvg: mocks.toSvg, toPng: mocks.toPng }));
vi.mock('jspdf', () => ({
  jsPDF: class MockJsPdf {
    addPage = mocks.addPage;
    addImage = mocks.addImage;
    setDrawColor = vi.fn();
    setLineWidth = vi.fn();
    line = mocks.line;
    setFontSize = vi.fn();
    setTextColor = vi.fn();
    text = mocks.text;
    output = mocks.output;
  },
}));

const options = (patch: Partial<DiagramExportOptions> = {}): DiagramExportOptions => ({ format: 'png', scope: 'current-viewport', scale: 2, transparent: false, backgroundColor: '#ffffff', padding: 0, pageSize: 'letter', orientation: 'landscape', tileOverlapInches: 0.25, ...patch });

function viewport(width: number, height: number): HTMLElement {
  const root = document.createElement('div'); root.className = 'react-flow';
  Object.defineProperty(root, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(root, 'clientHeight', { configurable: true, value: height });
  const element = document.createElement('div'); element.className = 'react-flow__viewport'; element.style.transform = 'translate(0px, 0px) scale(1)';
  root.append(element); document.body.append(root);
  return element;
}

describe('diagram export service', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.toBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    mocks.toSvg.mockResolvedValue('data:image/svg+xml,diagram');
    mocks.toPng.mockResolvedValue('data:image/png;base64,dGlsZQ==');
    mocks.output.mockReturnValue(new Blob(['pdf'], { type: 'application/pdf' }));
  });
  afterEach(() => { document.body.innerHTML = ''; document.documentElement.classList.remove('is-exporting'); vi.unstubAllGlobals(); });

  it('passes scale and background to PNG capture and cleans up export state', async () => {
    const result = await exportDiagram(viewport(640, 360), [], options());
    expect(result.filename).toBe('architecture.png');
    expect(result.blob.type).toBe('image/png');
    expect(mocks.toBlob).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ width: 640, height: 360, pixelRatio: 2, backgroundColor: '#ffffff' }));
    expect(document.documentElement).not.toHaveClass('is-exporting');
  });

  it('returns SVG content with the SVG MIME type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['<svg/>'], { type: 'image/svg+xml' }) })));
    const result = await exportDiagram(viewport(300, 200), [], options({ format: 'svg', transparent: true }));
    expect(result.filename).toBe('architecture.svg');
    expect(result.blob.type).toBe('image/svg+xml');
    expect(mocks.toSvg).toHaveBeenCalledWith(expect.any(HTMLElement), expect.not.objectContaining({ backgroundColor: expect.anything() }));
  });

  it('renders PDF tiles independently in row-major order with overlap and progress', async () => {
    const width = 1600; const height = 1100; const selected = options({ format: 'pdf', scale: 1 });
    const tiles = calculatePdfTiles(width, height, selected); const total = tiles.columns * tiles.rows;
    const progress = vi.fn();
    const result = await exportDiagram(viewport(width, height), [], selected, progress);
    expect(result.filename).toBe('architecture.pdf');
    expect(mocks.toPng).toHaveBeenCalledTimes(total);
    expect(mocks.addPage).toHaveBeenCalledTimes(total - 1);
    expect(mocks.addImage).toHaveBeenCalledTimes(total);
    expect(mocks.toPng.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ pixelRatio: 2 }));
    expect((mocks.toPng.mock.calls[1]?.[1] as { style: { transform: string } }).style.transform).toContain(`-${tiles.stepX}px`);
    expect((mocks.toPng.mock.calls[tiles.columns]?.[1] as { style: { transform: string } }).style.transform).toContain(`-${tiles.stepY}px`);
    expect(progress).toHaveBeenLastCalledWith('complete', total, total, 'PDF export ready.');
  });

  it('removes capture state when an encoder fails', async () => {
    mocks.toBlob.mockRejectedValueOnce(new Error('encoder failed'));
    await expect(exportDiagram(viewport(400, 300), [], options())).rejects.toThrow('encoder failed');
    expect(document.documentElement).not.toHaveClass('is-exporting');
  });

  it('excludes review comments but retains presentation elements', () => {
    const comments = document.createElement('div'); comments.dataset.exportExclude = 'true'; const card = document.createElement('article'); comments.append(card);
    const text = document.createElement('article'); text.className = 'text-node';
    expect(exportFilter(comments)).toBe(false); expect(exportFilter(card)).toBe(false); expect(exportFilter(text)).toBe(true);
  });
});

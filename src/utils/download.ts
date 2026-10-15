/**
 * @file Browser download helpers.
 * @module utils/download
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file creates Blob downloads, text downloads, and file text readers for export workflows.
 */
/** Triggers a browser download for a Blob and revokes its object URL. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Downloads plain text or serialized data as a typed Blob. */
export function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Reads the text content of a browser File. */
export async function readFileText(file: File): Promise<string> { return file.text(); }

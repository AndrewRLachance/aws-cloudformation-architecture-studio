/**
 * @file Diagram persistence repository implementations.
 * @module persistence/repository
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file serializes, deserializes, validates, and stores diagram documents in browser localStorage.
 */
import type { DiagramDocument } from '../domain/types';
import { parseDiagramDocument } from '../domain/schema';

/** Persistence boundary for saving and loading diagram documents. */
export interface DiagramRepository {
  save(document: DiagramDocument): Promise<void>;
  load(): Promise<DiagramDocument | undefined>;
  clear(): Promise<void>;
}

/** Diagram repository backed by browser localStorage. */
export class LocalStorageDiagramRepository implements DiagramRepository {
  constructor(private readonly key = 'aws-cfn-architecture-studio:autosave') {}
  async save(document: DiagramDocument): Promise<void> {
    localStorage.setItem(this.key, serializeDocument(document));
  }
  async load(): Promise<DiagramDocument | undefined> {
    const value = localStorage.getItem(this.key);
    if (!value) return undefined;
    return parseDiagramDocument(JSON.parse(value) as unknown);
  }
  async clear(): Promise<void> { localStorage.removeItem(this.key); }
}

/** Recursively sorts object keys for deterministic document serialization. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

/** Serializes a diagram document with deterministic key ordering. */
export function serializeDocument(document: DiagramDocument): string {
  return `${JSON.stringify(normalize(document), null, 2)}\n`;
}

/** Parses and validates serialized diagram JSON. */
export function deserializeDocument(text: string): DiagramDocument {
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch (error) { throw new Error(`Diagram JSON is malformed: ${error instanceof Error ? error.message : String(error)}`); }
  return parseDiagramDocument(parsed);
}

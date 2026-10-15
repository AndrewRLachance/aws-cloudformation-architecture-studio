/**
 * @file Identifier and hashing utilities.
 * @module domain/ids
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file creates deterministic IDs, random IDs, and content hashes for documents and imported templates.
 */
/** Shared UTF-8 encoder for stable hashing helpers. */
const encoder = new TextEncoder();

/** Creates a deterministic FNV-1a based identifier from stable string parts. */
export function stableId(prefix: string, ...parts: readonly string[]): string {
  const input = parts.join('\u241f');
  let hash = 2166136261;
  for (const byte of encoder.encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

/** Creates a random identifier with a domain-specific prefix. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Computes a SHA-256 hex digest for text content. */
export async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

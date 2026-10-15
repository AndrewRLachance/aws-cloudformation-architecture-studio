import type { ReusablePattern } from '../templates/patterns';

interface PatternLibrary { readonly schemaVersion: 1; readonly patterns: readonly ReusablePattern[]; }

export class LocalStoragePatternRepository {
  constructor(private readonly key = 'aws-cfn-architecture-studio:patterns:v1') {}
  load(): ReusablePattern[] {
    const raw = localStorage.getItem(this.key); if (!raw) return [];
    try { const parsed = JSON.parse(raw) as PatternLibrary; return parsed.schemaVersion === 1 && Array.isArray(parsed.patterns) ? parsed.patterns.map((pattern) => ({ ...pattern, logicalGroups: pattern.logicalGroups ?? [] })) : []; } catch { return []; }
  }
  save(patterns: readonly ReusablePattern[]): void { localStorage.setItem(this.key, JSON.stringify({ schemaVersion: 1, patterns } satisfies PatternLibrary)); }
}

/**
 * @file Searchable syntax-highlighted source viewer with line navigation.
 * @module ui/components/SourceCodeViewer
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-diff';
import { downloadText } from '../../utils/download';

export interface SourceCodeViewerProps {
  readonly text: string;
  readonly language: 'yaml' | 'json' | 'diff';
  readonly activeLine?: number;
  readonly ariaLabel?: string;
  readonly filename?: string;
}

/** Renders escaped Prism output line by line and provides keyboard-accessible search. */
export function SourceCodeViewer({ text, language, activeLine, ariaLabel = 'Template source', filename = `source.${language === 'diff' ? 'diff' : language === 'json' ? 'json' : 'yaml'}` }: SourceCodeViewerProps) {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.replace(/\n$/, '').split('\n'), [text]);
  const matches = useMemo(() => query ? lines.flatMap((line, index) => line.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ? [index] : []) : [], [lines, query]);
  const highlighted = useMemo(() => {
    const grammar = (language === 'diff' ? Prism.languages.diff : Prism.languages[language]) ?? Prism.languages.markup;
    return lines.map((line) => Prism.highlight(line || ' ', grammar as Prism.Grammar, language));
  }, [language, lines]);
  const selectedLine = matches.length > 0 ? matches[Math.min(matchIndex, matches.length - 1)] : activeLine ? activeLine - 1 : undefined;
  useEffect(() => {
    if (selectedLine === undefined) return;
    const target = container.current?.querySelector<HTMLElement>(`[data-line="${selectedLine + 1}"]`);
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  }, [selectedLine]);
  const move = (delta: number): void => { if (matches.length) setMatchIndex((index) => (index + delta + matches.length) % matches.length); };
  return <div className="source-viewer">
    <div className="source-search"><label>Search source<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setMatchIndex(0); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); move(event.shiftKey ? -1 : 1); } }} /></label><span aria-live="polite">{query ? `${matches.length ? matchIndex + 1 : 0} of ${matches.length}` : `${lines.length} lines`}</span><button type="button" onClick={() => move(-1)} disabled={!matches.length} aria-label="Previous source match">↑</button><button type="button" onClick={() => move(1)} disabled={!matches.length} aria-label="Next source match">↓</button><button type="button" onClick={() => void navigator.clipboard.writeText(text)} aria-label="Copy source">Copy</button><button type="button" onClick={() => downloadText(text, filename, language === 'json' ? 'application/json' : language === 'yaml' ? 'application/yaml' : 'text/plain')} aria-label="Download source">Download</button></div>
    <div ref={container} className="source-code" role="region" aria-label={ariaLabel} tabIndex={0}>{highlighted.map((html, index) => <div key={index} data-line={index + 1} className={`source-line ${selectedLine === index ? 'is-active' : ''} ${matches.includes(index) ? 'is-match' : ''}`}><span className="line-number" aria-hidden="true">{index + 1}</span><code dangerouslySetInnerHTML={{ __html: html }} /></div>)}</div>
  </div>;
}

/**
 * @file Bottom diagnostics and activity panel.
 * @module ui/components/BottomPanel
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file displays validation issues, imported sources, and the current import or layout operation.
 */
import { useShallow } from 'zustand/react/shallow';
import { useDiagramStore } from '../../store/useDiagramStore';

/** Props controlling bottom diagnostics panel collapse state. */
export interface BottomPanelProps { readonly collapsed: boolean; readonly onToggle: () => void; }

/** Renders validation, import, and active-operation diagnostics. */
export function BottomPanel({ collapsed, onToggle }: BottomPanelProps) {
  const { issues, layoutState, importPreview, document, operation } = useDiagramStore(useShallow((state) => ({ issues: state.validationIssues, layoutState: state.layoutState, importPreview: state.importPreview, document: state.document, operation: state.operationProgress })));
  const openSource = useDiagramStore((state) => state.openSource);
  const sourceNodeFor = (issue: (typeof issues)[number]) => issue.nodeId ?? Object.values(document.nodesById).find((node) => {
    if (!issue.templateId || node.sourceTemplateId !== issue.templateId) return false;
    if (!issue.path || !node.sourceLogicalId) return true;
    return issue.path.includes(`Resources.${node.sourceLogicalId}`);
  })?.id;
  return <section className={`bottom-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="Diagnostics and document activity">
    <button type="button" className="bottom-panel-toggle" onClick={onToggle} aria-expanded={!collapsed}><span>Diagnostics</span><span>{issues.length} validation · {document.templateOrder.length} templates · {layoutState.status}</span><span>{collapsed ? '⌃' : '⌄'}</span></button>
    {!collapsed && <div className="bottom-panel-content"><section><h3>Validation</h3>{issues.length ? <ul className="compact-list">{issues.slice(0, 20).map((issue) => { const sourceNodeId = sourceNodeFor(issue); return <li key={issue.id} className={`severity-${issue.severity}`}><strong>{issue.severity} · {issue.code}</strong><span>{issue.filename ? `${issue.filename}: ` : ''}{issue.message}</span>{sourceNodeId && <button type="button" onClick={() => openSource(sourceNodeId, issue.path)}>View source</button>}</li>; })}</ul> : <p className="success-note">Normalized document integrity is valid.</p>}</section><section><h3>Imported sources</h3>{document.importSourceOrder.length ? <ul className="compact-list">{document.importSourceOrder.map((id) => { const source = document.importSourcesById[id]; return source && <li key={id}><strong>{source.importType}{source.cloudAssembly ? ' · CDK assembly' : ''}</strong><span>{source.filenames.join(', ')}</span></li>; })}</ul> : <p>No CloudFormation sources imported in this document.</p>}</section><section><h3>Active operation</h3>{operation ? <div className={`operation-status status-${operation.status}`}><progress max={operation.total || 1} value={operation.completed} aria-label={`${operation.kind} progress`} /><strong>{operation.phase}</strong><p>{operation.message}</p><span>{operation.percent !== undefined ? `${operation.percent}%` : `${operation.completed} of ${operation.total}`}</span></div> : <p>{layoutState.message ?? (importPreview ? `Import preview: ${importPreview.summary.resourceCount} resources` : 'No active import or layout operation.')}</p>}</section></div>}
  </section>;
}

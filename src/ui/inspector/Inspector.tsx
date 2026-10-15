/**
 * @file Selection inspector and template viewer.
 * @module ui/inspector/Inspector
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file shows node and edge metadata, placement, validation, relationships, and CloudFormation source views.
 */
import { useMemo, useState } from 'react';
import { stringify } from 'yaml';
import { useShallow } from 'zustand/react/shallow';
import { generateCloudFormation } from '../../cloudformation/generator';
import type { DiagramNode, InspectorTab, StackSetDeploymentGroup } from '../../domain/types';
import { containmentPolicy } from '../../domain/containment';
import { useDiagramStore } from '../../store/useDiagramStore';
import { downloadText } from '../../utils/download';
import { CloudFormationPropertyEditor } from './CloudFormationPropertyEditor';
import { SourceCodeViewer } from '../components/SourceCodeViewer';
import { StackSetTargetEditor } from '../components/StackSetTargetEditor';
import { RelationshipEditorDialog } from '../dialogs/RelationshipEditorDialog';
import { BulkInspector } from './BulkInspector';
import { AnnotationEditor } from './AnnotationEditor';

/** Tab definitions shown in the selection inspector. */
const TABS: readonly { id: InspectorTab; label: string }[] = [
  { id: 'properties', label: 'Properties' }, { id: 'placement', label: 'Placement' }, { id: 'stack-membership', label: 'Stack membership' }, { id: 'logical-groups', label: 'Logical groups' }, { id: 'security', label: 'Security' }, { id: 'relationships', label: 'Relationships' }, { id: 'validation', label: 'Validation' }, { id: 'template', label: 'Template' },
];

/** Props controlling inspector collapse state and toggle behavior. */
export interface InspectorProps { readonly collapsed: boolean; readonly onToggle: () => void; }

/** Produces a compact line-by-line diff for original and generated template text. */
function lineDiff(original: string, generated: string): string {
  const before = original.split('\n');
  const after = generated.split('\n');
  const lines: string[] = [];
  const count = Math.max(before.length, after.length);
  for (let index = 0; index < count; index += 1) {
    if (before[index] === after[index]) lines.push(`  ${before[index] ?? ''}`);
    else { if (before[index] !== undefined) lines.push(`- ${before[index]}`); if (after[index] !== undefined) lines.push(`+ ${after[index]}`); }
  }
  return lines.join('\n');
}

/** Renders original and generated CloudFormation source for a selected node. */
function TemplateInspector({ node }: { readonly node: DiagramNode }) {
  const document = useDiagramStore((state) => state.document);
  const sourceNavigation = useDiagramStore((state) => state.sourceNavigation);
  const generated = useMemo(() => generateCloudFormation(document), [document]);
  const originalTemplate = node.sourceTemplateId ? document.templatesById[node.sourceTemplateId] : undefined;
  const navigating = sourceNavigation?.nodeId === node.id;
  const [format, setFormat] = useState<'yaml' | 'json'>(navigating && originalTemplate ? originalTemplate.originalFormat : 'yaml');
  const [view, setView] = useState<'original-template' | 'generated-template' | 'original-resource' | 'generated-resource' | 'diff'>(navigating ? 'original-template' : 'original-resource');
  const ownerId = node.stackId ?? node.stackSetId;
  const generatedTemplate = generated.templates.find((template) => template.ownerId === ownerId);
  const roundTrip = originalTemplate ? generated.roundTripComparisons.find((comparison) => comparison.templateId === originalTemplate.id) : undefined;
  const originalResource = originalTemplate && node.sourceLogicalId ? originalTemplate.resources[node.sourceLogicalId] : undefined;
  const generatedResources = generatedTemplate?.ast.Resources;
  const generatedResource = generatedResources && typeof generatedResources === 'object' && !Array.isArray(generatedResources) && node.sourceLogicalId ? (generatedResources as Record<string, unknown>)[node.sourceLogicalId] : undefined;
  const render = (value: unknown): string => format === 'json' ? `${JSON.stringify(value ?? {}, null, 2)}\n` : stringify(value ?? {}, { lineWidth: 0 });
  const originalTemplateText = originalTemplate ? (format === originalTemplate.originalFormat ? originalTemplate.originalSourceText : render(originalTemplate.canonicalAst)) : 'No imported source is associated with this node.\n';
  const generatedTemplateText = generatedTemplate ? (format === 'json' ? generatedTemplate.json : generatedTemplate.yaml) : 'This node has no generated stack or StackSet template.\n';
  const text = view === 'original-template' ? originalTemplateText : view === 'generated-template' ? generatedTemplateText : view === 'original-resource' ? render(originalResource) : view === 'generated-resource' ? render(generatedResource) : lineDiff(render(originalResource), render(generatedResource));
  const filename = `${node.name.replace(/[^A-Za-z0-9._-]+/g, '-')}-${view}.${format === 'json' ? 'json' : 'yaml'}`;
  const sourcePath = sourceNavigation?.nodeId === node.id ? sourceNavigation.path : node.sourcePropertyPath ?? (node.sourceLogicalId ? `Resources.${node.sourceLogicalId}` : '');
  const mappedLine = originalTemplate ? originalTemplate.sourceLocations[sourcePath]?.line ?? (node.sourceLogicalId ? originalTemplate.sourceLocations[`Resources.${node.sourceLogicalId}`]?.line : undefined) : undefined;
  const logicalId = node.sourceLogicalId;
  const fallbackLine = originalTemplate && logicalId ? originalTemplate.originalSourceText.split('\n').findIndex((line) => line.includes(logicalId)) + 1 : 0;
  const activeLine = mappedLine ?? (fallbackLine > 0 ? fallbackLine : undefined);
  return <div className="template-inspector">
    {originalTemplate && <div className="property-badges"><span>{originalTemplate.fidelity.dialects.join(' · ')}</span><span>analysis {originalTemplate.fidelity.confidence}</span>{roundTrip && <span>round trip: {roundTrip.status}</span>}</div>}
    <div className="segmented"><button type="button" className={format === 'yaml' ? 'is-active' : ''} onClick={() => setFormat('yaml')}>YAML</button><button type="button" className={format === 'json' ? 'is-active' : ''} onClick={() => setFormat('json')}>JSON</button></div>
    <label>Template view<select value={view} onChange={(event) => setView(event.target.value as typeof view)}><option value="original-template">Original imported template</option><option value="generated-template">Generated template</option><option value="original-resource">Original resource</option><option value="generated-resource">Generated resource</option><option value="diff">Semantic diff</option></select></label>
    <div className="template-actions">{originalTemplate && <button type="button" onClick={() => downloadText(originalTemplate.originalSourceText, originalTemplate.originalFilename)}>Download original</button>}{generatedTemplate && <button type="button" onClick={() => downloadText(format === 'json' ? generatedTemplate.json : generatedTemplate.yaml, generatedTemplate.filename)}>Download generated</button>}</div>
    <p className="source-path">Source path: {sourcePath || 'not available'}{activeLine ? ` · line ${activeLine}` : ''}</p>
    <SourceCodeViewer text={text} language={view === 'diff' ? 'diff' : format} activeLine={view === 'original-template' ? activeLine : undefined} ariaLabel={`${view.replaceAll('-', ' ')} source`} filename={filename} />
    {originalTemplate && [...originalTemplate.parseDiagnostics, ...originalTemplate.unsupportedFeatureDiagnostics].length > 0 && <ul className="diagnostic-list">{[...originalTemplate.parseDiagnostics, ...originalTemplate.unsupportedFeatureDiagnostics].map((item) => <li key={item.id} className={`severity-${item.severity}`}><strong>{item.code}</strong><p>{item.message}</p></li>)}</ul>}
    {generated.warnings.length > 0 && <ul className="diagnostic-list">{generated.warnings.map((warning) => <li key={`${warning.code}-${warning.nodeId ?? ''}`} className="severity-warning"><strong>{warning.code}</strong><p>{warning.message}</p></li>)}</ul>}
  </div>;
}

/** Renders selected entity details, validation, placement, and template views. */
export function Inspector({ collapsed, onToggle }: InspectorProps) {
  const [editingEdge, setEditingEdge] = useState(false);
  const { document, selection, validationIssues, tab, sourceNavigation } = useDiagramStore(useShallow((state) => ({ document: state.document, selection: state.selection, validationIssues: state.validationIssues, tab: state.inspectorTab, sourceNavigation: state.sourceNavigation })));
  const updateNode = useDiagramStore((state) => state.updateNode);
  const updateDeploymentGroup = useDiagramStore((state) => state.updateDeploymentGroup);
  const reparentNode = useDiagramStore((state) => state.reparentNode);
  const setTab = useDiagramStore((state) => state.setInspectorTab);
  const openSource = useDiagramStore((state) => state.openSource);
  const bringForward = useDiagramStore((state) => state.bringForward); const sendBackward = useDiagramStore((state) => state.sendBackward); const bringToFront = useDiagramStore((state) => state.bringToFront); const sendToBack = useDiagramStore((state) => state.sendToBack);
  const selectedNode = selection.nodeIds.length === 1 ? document.nodesById[selection.nodeIds[0] ?? ''] : undefined;
  const selectedEdge = selection.edgeIds.length === 1 ? document.edgesById[selection.edgeIds[0] ?? ''] : undefined;
  if (collapsed) return <aside className="inspector is-collapsed" aria-label="Inspector"><button type="button" className="vertical-toggle" onClick={onToggle} aria-label="Expand inspector">Inspector</button></aside>;
  const relationships = selectedNode ? document.edgeOrder.map((id) => document.edgesById[id]).filter((edge) => edge && (edge.source === selectedNode.id || edge.target === selectedNode.id)) : [];
  const nodeIssues = selectedNode ? validationIssues.filter((issue) => issue.nodeId === selectedNode.id || issue.templateId === selectedNode.sourceTemplateId) : validationIssues;
  const selectedStack = selectedNode?.stackId ? document.deploymentGroupsById[selectedNode.stackId] : undefined;
  const deploymentMetadata = selectedStack?.kind === 'stack' ? selectedStack.deploymentMetadata : [];
  const allowedParents = selectedNode ? Object.values(document.nodesById).filter((candidate) => candidate.kind === 'boundary' && containmentPolicy.decide(document, selectedNode.id, candidate.id).valid) : [];
  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="panel-heading"><div><span className="eyebrow">Selection</span><h2>Inspector</h2></div><button type="button" className="icon-button" onClick={onToggle} aria-label="Collapse inspector">›</button></div>
      {selectedEdge ? <div className="inspector-content"><h3>Relationship</h3><dl className="property-list"><div><dt>Type</dt><dd>{selectedEdge.relationshipType}</dd></div><div><dt>Source</dt><dd>{document.nodesById[selectedEdge.source]?.name ?? selectedEdge.source}</dd></div><div><dt>Target</dt><dd>{document.nodesById[selectedEdge.target]?.name ?? selectedEdge.target}</dd></div><div><dt>Path</dt><dd>{selectedEdge.sourcePropertyPath ?? 'visual only'}</dd></div><div><dt>Status</dt><dd>{selectedEdge.validationStatus}</dd></div></dl><button type="button" onClick={() => setEditingEdge(true)}>Edit relationship</button><RelationshipEditorDialog key={selectedEdge.id} open={editingEdge} edgeId={selectedEdge.id} sourceId={selectedEdge.source} targetId={selectedEdge.target} sourceHandle={selectedEdge.sourceHandle} targetHandle={selectedEdge.targetHandle} onClose={() => setEditingEdge(false)} /></div> : selection.nodeIds.length > 1 ? <BulkInspector nodeIds={selection.nodeIds} /> : selectedNode ? <>
        <div className="inspector-title"><span className="node-kicker">{selectedNode.kind}</span><h3>{selectedNode.name}</h3></div>
        <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">{TABS.map((item) => <button key={item.id} id={`tab-${item.id}`} type="button" role="tab" aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
        <div className="inspector-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'properties' && <div className="field-stack"><label>Name<input defaultValue={selectedNode.name} key={selectedNode.id} onBlur={(event) => updateNode(selectedNode.id, { name: event.target.value.trim() || selectedNode.name }, 'rename-node')} /></label><dl className="property-list"><div><dt>ID</dt><dd>{selectedNode.id}</dd></div><div><dt>Kind</dt><dd>{selectedNode.kind}</dd></div>{selectedNode.kind === 'aws-resource' && <><div><dt>Resource type</dt><dd>{selectedNode.resourceType}</dd></div><div><dt>CloudFormation type</dt><dd>{selectedNode.cloudFormationType}</dd></div></>}{selectedNode.sourceProjection && <div><dt>Projection</dt><dd>{selectedNode.sourceProjection.loopName} · {selectedNode.sourceProjection.iterationValue}</dd></div>}{selectedNode.cdkConstructPath && <div><dt>CDK path</dt><dd>{selectedNode.cdkConstructPath}</dd></div>}{selectedNode.cdkHelper && <div><dt>CDK helper</dt><dd>Preserved framework resource</dd></div>}</dl>{selectedNode.kind === 'text' && <><label>Text<textarea defaultValue={selectedNode.text} onBlur={(event) => updateNode(selectedNode.id, { text: event.target.value } as Partial<DiagramNode>, 'edit-text')} /></label><label>Font size<input type="number" min="8" max="96" value={selectedNode.style.fontSize} onChange={(event) => updateNode(selectedNode.id, { style: { ...selectedNode.style, fontSize: Number(event.target.value) } } as Partial<DiagramNode>, 'edit-text-style')} /></label></>}{selectedNode.kind === 'legend' && <><label>Legend title<input value={selectedNode.title} onChange={(event) => updateNode(selectedNode.id, { title: event.target.value } as Partial<DiagramNode>, 'edit-legend')} /></label><label>Mode<select value={selectedNode.mode} onChange={(event) => updateNode(selectedNode.id, { mode: event.target.value } as Partial<DiagramNode>, 'edit-legend')}><option value="automatic">Automatic</option><option value="manual">Manual</option></select></label>{selectedNode.mode === 'manual' && <label>Manual entries JSON<textarea defaultValue={JSON.stringify(selectedNode.entries, null, 2)} onBlur={(event) => { try { const entries = JSON.parse(event.target.value) as typeof selectedNode.entries; updateNode(selectedNode.id, { entries } as Partial<DiagramNode>, 'edit-legend-entries'); } catch { /* retain the last valid value */ } }} /></label>}</>}{(selectedNode.kind === 'aws-resource' || selectedNode.kind === 'boundary' && selectedNode.cloudFormation) && <CloudFormationPropertyEditor key={selectedNode.id} node={selectedNode} />}<AnnotationEditor node={selectedNode} onChange={(annotations) => updateNode(selectedNode.id, { annotations }, 'edit-annotations')} />{selectedNode.sourceTemplateId && <button type="button" onClick={() => openSource(selectedNode.id)}>Go to CloudFormation source</button>}</div>}
          {tab === 'placement' && <div className="field-stack"><dl className="property-list"><div><dt>Physical parent</dt><dd>{selectedNode.physicalParentId ? document.nodesById[selectedNode.physicalParentId]?.name : 'Diagram root'}</dd></div><div><dt>Position</dt><dd>{Math.round(selectedNode.position.x)}, {Math.round(selectedNode.position.y)}</dd></div><div><dt>Size</dt><dd>{Math.round(selectedNode.size.width)} × {Math.round(selectedNode.size.height)}</dd></div><div><dt>Z-order</dt><dd>{selectedNode.zIndex}</dd></div><div><dt>Confidence</dt><dd>{selectedNode.placementConfidence ?? 'manual'}</dd></div></dl><label>Move to physical boundary<select value={selectedNode.physicalParentId ?? ''} onChange={(event) => reparentNode(selectedNode.id, event.target.value || undefined)}><option value="">Diagram root</option>{allowedParents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><div className="z-order-controls"><button type="button" onClick={() => sendToBack(selectedNode.id)}>Send to back</button><button type="button" onClick={() => sendBackward(selectedNode.id)}>Send backward</button><button type="button" onClick={() => bringForward(selectedNode.id)}>Bring forward</button><button type="button" onClick={() => bringToFront(selectedNode.id)}>Bring to front</button></div></div>}
          {tab === 'stack-membership' && <div><dl className="property-list"><div><dt>Stack</dt><dd>{selectedNode.stackId ? document.deploymentGroupsById[selectedNode.stackId]?.name : 'None'}</dd></div><div><dt>StackSet</dt><dd>{selectedNode.stackSetId ? document.deploymentGroupsById[selectedNode.stackSetId]?.name : 'None'}</dd></div><div><dt>Stack instance</dt><dd>{selectedNode.stackInstanceId ?? 'Derived by deployment view'}</dd></div><div><dt>Source template</dt><dd>{selectedNode.sourceTemplateId ? document.templatesById[selectedNode.sourceTemplateId]?.originalFilename : 'None'}</dd></div></dl>{selectedStack?.kind === 'stack' && <section><h4>Deployment metadata</h4>{deploymentMetadata.length ? <ul className="compact-list">{deploymentMetadata.map((artifact) => <li key={artifact.id}><strong>{artifact.kind}</strong><span>{artifact.originalFilename} · {artifact.associationEvidence ?? 'imported'}</span></li>)}</ul> : <p>No deployment metadata supplied.</p>}</section>}{selectedNode.stackSetId && document.deploymentGroupsById[selectedNode.stackSetId]?.kind === 'stackset' && <StackSetTargetEditor group={document.deploymentGroupsById[selectedNode.stackSetId] as StackSetDeploymentGroup} onChange={(group) => updateDeploymentGroup(group.id, group, 'edit-stackset-targets')} />}</div>}
          {tab === 'logical-groups' && <ul className="compact-list">{selectedNode.logicalGroupIds.length > 0 ? selectedNode.logicalGroupIds.map((id) => <li key={id}><span>{document.logicalGroupsById[id]?.name ?? id}</span></li>) : <li>No logical memberships</li>}</ul>}
          {tab === 'security' && <dl className="property-list"><div><dt>Security groups</dt><dd>{selectedNode.securityGroupIds.length ? selectedNode.securityGroupIds.map((id) => document.nodesById[id]?.name ?? id).join(', ') : 'None'}</dd></div><div><dt>Governance controls</dt><dd>{selectedNode.attachedControlIds.length ? selectedNode.attachedControlIds.map((id) => document.nodesById[id]?.name ?? id).join(', ') : 'None'}</dd></div></dl>}
          {tab === 'relationships' && <ul className="relationship-list">{relationships.length ? relationships.map((edge) => edge && <li key={edge.id}><strong>{edge.relationshipType}</strong><span>{edge.source === selectedNode.id ? '→' : '←'} {document.nodesById[edge.source === selectedNode.id ? edge.target : edge.source]?.name}</span><small>{edge.sourcePropertyPath ?? 'manual relationship'}</small></li>) : <li>No relationships</li>}</ul>}
          {tab === 'validation' && <ul className="diagnostic-list">{nodeIssues.length ? nodeIssues.map((issue) => <li key={issue.id} className={`severity-${issue.severity}`}><strong>{issue.code}</strong><p>{issue.message}</p></li>) : <li className="success-note">No validation issues.</li>}</ul>}
          {tab === 'template' && <TemplateInspector key={`${selectedNode.id}:${sourceNavigation?.nodeId === selectedNode.id ? sourceNavigation.path : 'default'}`} node={selectedNode} />}
        </div>
      </> : <div className="empty-inspector"><strong>No selection</strong><p>Select a node or edge to inspect its normalized metadata and CloudFormation source.</p><dl className="metric-grid"><div><dt>Nodes</dt><dd>{document.nodeOrder.length}</dd></div><div><dt>Edges</dt><dd>{document.edgeOrder.length}</dd></div><div><dt>Stacks</dt><dd>{document.deploymentGroupOrder.length}</dd></div><div><dt>Templates</dt><dd>{document.templateOrder.length}</dd></div></dl></div>}
    </aside>
  );
}

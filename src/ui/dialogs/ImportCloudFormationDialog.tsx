/**
 * @file Graphical CloudFormation import, association, reconciliation, and commit workflow.
 * @module ui/dialogs/ImportCloudFormationDialog
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  analyzeCloudFormationImport,
  buildCloudFormationImportPlanFromAnalysis,
  type ImportFile,
  type ImportOptions,
} from '../../cloudformation/importer';
import { reconcileImportPlan, type RemovedResourcePolicy, type RemovedResourcePolicySelection } from '../../cloudformation/reimport';
import { validateStackSetTargets } from '../../cloudformation/stackset';
import type {
  CloudFormationImportAnalysis,
  CloudFormationImportPlan,
  ImportAssociationResolution,
  LayoutRequest,
  NestedAssociationResolution,
  StackSetDeploymentGroup,
} from '../../domain/types';
import { uniqueId } from '../../domain/ids';
import { DiagramLayoutService } from '../../layout/service';
import { useDiagramStore } from '../../store/useDiagramStore';
import { StackSetTargetEditor } from '../components/StackSetTargetEditor';
import { SourceCodeViewer } from '../components/SourceCodeViewer';

const STEPS = ['Import type', 'Files', 'Analyze', 'Associations', 'Review', 'Options', 'Commit'] as const;
const layoutService = new DiagramLayoutService();

export interface ImportCloudFormationDialogProps { readonly open: boolean; readonly onClose: () => void; }

async function browserFiles(files: readonly File[], report: (completed: number, total: number, message: string) => void): Promise<ImportFile[]> {
  const imported: ImportFile[] = [];
  for (const [index, file] of files.entries()) {
    report(index, files.length, `Reading ${file.name}.`);
    imported.push({ name: file.name, data: file.name.toLowerCase().endsWith('.zip') ? await file.arrayBuffer() : await file.text() });
  }
  report(files.length, files.length, `${files.length} file${files.length === 1 ? '' : 's'} read.`);
  return imported;
}

function initialAssociations(analysis: CloudFormationImportAnalysis): ImportAssociationResolution[] {
  return analysis.templates.flatMap((template) => {
    const candidates = analysis.associationCandidates.filter((candidate) => candidate.templateId === template.id).sort((a, b) => ['high','medium','low'].indexOf(a.confidence) - ['high','medium','low'].indexOf(b.confidence));
    const candidate = candidates[0];
    if (!candidate) return [];
    return [{ templateId: template.id, candidateId: candidate.id, ownerKind: candidate.ownerKind, ownerId: candidate.ownerId, name: candidate.name, ...(candidate.accountId ? { accountId: candidate.accountId } : {}), ...(candidate.region ? { region: candidate.region } : {}), confirmed: !analysis.requiresAssociationConfirmation.includes(template.id) }];
  });
}

function initialNestedAssociations(analysis: CloudFormationImportAnalysis): NestedAssociationResolution[] {
  return analysis.draftPlan.deploymentGroups.filter((group) => group.kind === 'nested-stack').flatMap((group) => {
    const parent = analysis.draftPlan.nodes.find((node) => node.id === group.parentResourceNodeId);
    if (!parent?.sourceTemplateId || !parent.sourceLogicalId) return [];
    const best = analysis.nestedAssociationCandidates.filter((candidate) => candidate.parentTemplateId === parent.sourceTemplateId && candidate.parentLogicalId === parent.sourceLogicalId).sort((a, b) => b.score - a.score)[0];
    return [{ parentTemplateId: parent.sourceTemplateId, parentLogicalId: parent.sourceLogicalId, ...(best?.confidence === 'high' ? { childTemplateId: best.childTemplateId } : {}), disposition: best?.confidence === 'high' ? 'associate' : 'leave-unresolved', confirmed: false }];
  });
}

function applyStackSetEdits(plan: CloudFormationImportPlan, edits: Readonly<Record<string, StackSetDeploymentGroup>>): CloudFormationImportPlan {
  return { ...plan, deploymentGroups: plan.deploymentGroups.map((group) => group.kind === 'stackset' && edits[group.id] ? edits[group.id] as StackSetDeploymentGroup : group) };
}

/** Renders the local-only, preview-before-commit import workflow. */
export function ImportCloudFormationDialog({ open, onClose }: ImportCloudFormationDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [importType, setImportType] = useState<ImportOptions['importType']>('single-stack');
  const [files, setFiles] = useState<File[]>([]);
  const [accountId, setAccountId] = useState('');
  const [region, setRegion] = useState('');
  const [analysis, setAnalysis] = useState<CloudFormationImportAnalysis>();
  const [associations, setAssociations] = useState<ImportAssociationResolution[]>([]);
  const [nestedAssociations, setNestedAssociations] = useState<NestedAssociationResolution[]>([]);
  const [stackSetEdits, setStackSetEdits] = useState<Record<string, StackSetDeploymentGroup>>({});
  const [plan, setPlan] = useState<CloudFormationImportPlan>();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [mergeMode, setMergeMode] = useState<'merge' | 'replace'>('merge');
  const [autoLayout, setAutoLayout] = useState(true);
  const [removedPolicies, setRemovedPolicies] = useState<RemovedResourcePolicySelection>({ defaultPolicy: 'mark-removed', byResourceKey: {} });
  const operation = useDiagramStore((state) => state.operationProgress);
  const actions = useDiagramStore(useShallow((state) => ({ setImportPreview: state.setImportPreview, commitImport: state.commitImport, startLayout: state.startLayout, applyLayout: state.applyLayout, failLayout: state.failLayout, setOperationProgress: state.setOperationProgress })));

  useEffect(() => { if (open) dialogRef.current?.querySelector<HTMLElement>('button, input, select')?.focus(); }, [open, step]);

  const derivePlan = (nextAnalysis: CloudFormationImportAnalysis, nextAssociations: readonly ImportAssociationResolution[], nextNested: readonly NestedAssociationResolution[], nextPolicies = removedPolicies, nextStackSets = stackSetEdits): CloudFormationImportPlan => {
    let next = buildCloudFormationImportPlanFromAnalysis(nextAnalysis, nextAssociations, nextNested);
    next = applyStackSetEdits(next, nextStackSets);
    if (importType === 'reimport') next = reconcileImportPlan(useDiagramStore.getState().document, next, nextPolicies);
    setPlan(next); actions.setImportPreview(next);
    return next;
  };
  const close = (clearProgress = true): void => {
    setStep(0); setFiles([]); setAnalysis(undefined); setAssociations([]); setNestedAssociations([]); setStackSetEdits({}); setPlan(undefined); setError(''); actions.setImportPreview();
    if (clearProgress) actions.setOperationProgress();
    onClose();
  };
  const parse = async (): Promise<void> => {
    setParsing(true); setError('');
    const operationId = uniqueId('operation');
    const report = (phase: string, completed: number, total: number, message: string): void => actions.setOperationProgress({ id: operationId, kind: 'import', status: 'running', phase, completed, total, percent: total > 0 ? Math.round(completed / total * 100) : undefined, message });
    try {
      const imported = await browserFiles(files, (completed, total, message) => report('read', completed, total, message));
      const analyzed = await analyzeCloudFormationImport(imported, { importType, ...(accountId ? { defaultAccountId: accountId } : {}), ...(region ? { defaultRegion: region } : {}) }, report);
      const nextAssociations = initialAssociations(analyzed);
      const nextNested = initialNestedAssociations(analyzed);
      const base = buildCloudFormationImportPlanFromAnalysis(analyzed, nextAssociations, nextNested);
      const edits = Object.fromEntries(base.deploymentGroups.filter((group): group is StackSetDeploymentGroup => group.kind === 'stackset').map((group) => [group.id, group]));
      setAnalysis(analyzed); setAssociations(nextAssociations); setNestedAssociations(nextNested); setStackSetEdits(edits);
      let next = applyStackSetEdits(base, edits);
      if (importType === 'reimport') {
        report('reconcile', 0, 1, 'Reconciling imported resources with the current diagram.');
        next = reconcileImportPlan(useDiagramStore.getState().document, next, removedPolicies);
        report('reconcile', 1, 1, 'Reconciliation preview is ready.');
      }
      setPlan(next); actions.setImportPreview(next);
      actions.setOperationProgress({ id: operationId, kind: 'import', status: 'complete', phase: 'ready', completed: 1, total: 1, percent: 100, message: 'Import analysis is ready for review.' });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message); actions.setOperationProgress({ id: operationId, kind: 'import', status: 'error', phase: 'failed', completed: 0, total: 1, message });
    } finally { setParsing(false); }
  };
  const updateAssociation = (templateId: string, patch: Partial<ImportAssociationResolution>): void => {
    if (!analysis) return;
    const next = associations.map((item) => item.templateId === templateId ? { ...item, ...patch } : item);
    setAssociations(next); derivePlan(analysis, next, nestedAssociations);
  };
  const chooseCandidate = (templateId: string, candidateId: string): void => {
    if (!analysis) return;
    const candidate = analysis.associationCandidates.find((item) => item.id === candidateId);
    if (!candidate) return;
    updateAssociation(templateId, { candidateId, ownerKind: candidate.ownerKind, ownerId: candidate.ownerId, name: candidate.name, accountId: candidate.accountId, region: candidate.region, confirmed: false });
  };
  const updateNested = (index: number, patch: Partial<NestedAssociationResolution>): void => {
    if (!analysis) return;
    const next = nestedAssociations.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item);
    setNestedAssociations(next); derivePlan(analysis, associations, next);
  };
  const updateStackSet = (group: StackSetDeploymentGroup): void => {
    if (!analysis) return;
    const edits = { ...stackSetEdits, [group.id]: group };
    setStackSetEdits(edits); derivePlan(analysis, associations, nestedAssociations, removedPolicies, edits);
  };
  const updatePolicies = (next: RemovedResourcePolicySelection): void => {
    setRemovedPolicies(next); if (analysis) derivePlan(analysis, associations, nestedAssociations, next);
  };
  const nextStep = async (): Promise<void> => {
    if (step === 1 && files.length === 0) { setError('Select at least one CloudFormation file or ZIP archive.'); return; }
    if (step === 2 && !analysis) await parse();
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  };
  const commit = async (): Promise<void> => {
    if (!plan || !actions.commitImport(plan, mergeMode)) return;
    if (autoLayout) {
      const document = useDiagramStore.getState().document;
      const request: LayoutRequest = { id: uniqueId('layout'), direction: document.preferences.layoutDirection, density: document.preferences.layoutDensity, mode: 'physical-hierarchy', scope: 'newly-imported', selectedNodeIds: [], onlyUnpositioned: true, createdAt: new Date().toISOString() };
      actions.startLayout(request); actions.setOperationProgress({ id: request.id, kind: 'layout', status: 'running', phase: 'layout', completed: 0, total: 1, percent: 0, message: 'Laying out imported resources.' });
      try { const result = await layoutService.layout(document, request); if (result) actions.applyLayout(result); actions.setOperationProgress({ id: request.id, kind: 'layout', status: 'complete', phase: 'layout', completed: 1, total: 1, percent: 100, message: 'Imported resources laid out.' }); }
      catch (caught) { const message = caught instanceof Error ? caught.message : String(caught); actions.failLayout(message); actions.setOperationProgress({ id: request.id, kind: 'layout', status: 'error', phase: 'layout', completed: 0, total: 1, message }); }
    }
    close(false);
  };

  const blocking = plan?.diagnostics.some((item) => item.blocking) ?? false;
  const stackSetIssues = plan?.deploymentGroups.filter((group): group is StackSetDeploymentGroup => group.kind === 'stackset').flatMap((group) => validateStackSetTargets(group.permissionModel, group.targetGroups, group.operationPreferences)) ?? [];
  const resourceTypes = useMemo(() => {
    const counts = new Map<string, number>();
    plan?.nodes.forEach((node) => { const type = node.sourceResourceType ?? (node.kind === 'boundary' ? node.boundaryType : node.kind); counts.set(type, (counts.get(type) ?? 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [plan]);
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section ref={dialogRef} className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title" onKeyDown={(event) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
        if (!focusable.length) return;
        const index = focusable.indexOf(document.activeElement as HTMLElement); const target = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index >= focusable.length - 1 ? 0 : index + 1);
        event.preventDefault(); focusable[target]?.focus();
      }
    }}>
      <div className="dialog-header"><div><span className="eyebrow">Local, credential-free ingestion</span><h2 id="import-dialog-title">Import CloudFormation</h2></div><button type="button" className="icon-button" onClick={() => close()} aria-label="Close import dialog">×</button></div>
      <ol className="stepper" aria-label="Import progress">{STEPS.map((name, index) => <li key={name} className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}><span>{index + 1}</span>{name}</li>)}</ol>
      <div className="dialog-body">
        {step === 0 && <fieldset className="choice-grid"><legend>Select import type</legend>{([['single-stack','Raw single-stack template'],['stack-bundle','Existing deployed-stack bundle'],['multi-stack','Multiple-stack bundle'],['stackset','StackSet definition and instances'],['reimport','Re-import updated source']] as const).map(([value, label]) => <label key={value} className="choice-card"><input type="radio" name="import-type" checked={importType === value} onChange={() => { setImportType(value); setAnalysis(undefined); setPlan(undefined); actions.setImportPreview(); }} /><strong>{label}</strong><span>YAML, JSON, multiple files, or ZIP</span></label>)}</fieldset>}
        {step === 1 && <div className="file-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles([...event.dataTransfer.files]); }}><label><strong>Drop CloudFormation files here</strong><span>Accepted: .yaml, .yml, .json, .zip</span><input type="file" multiple accept=".yaml,.yml,.json,.zip" onChange={(event) => setFiles([...(event.target.files ?? [])])} /></label>{files.length > 0 && <ul>{files.map((file) => <li key={`${file.name}-${file.size}`}>{file.name} <span>{Math.ceil(file.size / 1024)} KB</span></li>)}</ul>}<div className="form-grid"><label>Default account ID<input value={accountId} onChange={(event) => setAccountId(event.target.value)} /></label><label>Default Region<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us-east-1" /></label></div></div>}
        {step === 2 && <div className="parse-stage"><h3>Parse and inspect once</h3><p>Files are classified, parsed, and analyzed locally. Later association changes reuse this immutable analysis.</p><button type="button" className="primary-button" onClick={() => void parse()} disabled={parsing || files.length === 0}>{parsing ? 'Analyzing…' : analysis ? 'Analyze again' : 'Analyze selected files'}</button>{plan && <div className="summary-strip"><span>{plan.summary.fileCount} files</span><span>{plan.summary.resourceCount} resources</span><span>{analysis?.associationCandidates.length ?? 0} association candidates</span></div>}</div>}
        {step === 3 && analysis && plan && <div className="association-stage"><h3>Template ownership</h3>{analysis.templates.map((template) => {
          const resolution = associations.find((item) => item.templateId === template.id); const choices = analysis.associationCandidates.filter((item) => item.templateId === template.id); if (!resolution) return null;
          return <fieldset className="association-card" key={template.id}><legend>{template.originalFilename}</legend><label>Detected association<select value={resolution.candidateId ?? ''} onChange={(event) => chooseCandidate(template.id, event.target.value)}>{choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.confidence} · {candidate.evidence.join(' ')}</option>)}</select></label><div className="form-grid"><label>Name<input value={resolution.name} onChange={(event) => updateAssociation(template.id, { name: event.target.value })} /></label><label>Account<input value={resolution.accountId ?? ''} onChange={(event) => updateAssociation(template.id, { accountId: event.target.value })} /></label><label>Region<input value={resolution.region ?? ''} onChange={(event) => updateAssociation(template.id, { region: event.target.value })} /></label></div>{analysis.requiresAssociationConfirmation.includes(template.id) && <label className="confirmation"><input type="checkbox" checked={resolution.confirmed} onChange={(event) => updateAssociation(template.id, { confirmed: event.target.checked })} />I confirm this stack association.</label>}</fieldset>;
        })}<h3>Nested stacks</h3>{nestedAssociations.length === 0 && <p>No nested stack resources were detected.</p>}{nestedAssociations.map((resolution, index) => {
          const candidates = analysis.nestedAssociationCandidates.filter((candidate) => candidate.parentTemplateId === resolution.parentTemplateId && candidate.parentLogicalId === resolution.parentLogicalId);
          const parentChoices = analysis.draftPlan.deploymentGroups.filter((group) => group.kind === 'nested-stack').flatMap((group) => {
            const parent = analysis.draftPlan.nodes.find((node) => node.id === group.parentResourceNodeId);
            return parent?.sourceTemplateId && parent.sourceLogicalId ? [{ templateId: parent.sourceTemplateId, logicalId: parent.sourceLogicalId, label: `${analysis.templates.find((template) => template.id === parent.sourceTemplateId)?.originalFilename ?? parent.sourceTemplateId} · ${parent.sourceLogicalId}` }] : [];
          });
          return <fieldset className="association-card" key={`${index}-${resolution.parentTemplateId}-${resolution.parentLogicalId}`}><legend>{resolution.parentLogicalId}</legend><label>Parent nested resource<select value={`${resolution.parentTemplateId}|${resolution.parentLogicalId}`} onChange={(event) => { const [parentTemplateId, parentLogicalId] = event.target.value.split('|'); if (parentTemplateId && parentLogicalId) updateNested(index, { parentTemplateId, parentLogicalId, disposition: 'leave-unresolved', childTemplateId: undefined, confirmed: false }); }}>{parentChoices.map((choice) => <option key={`${choice.templateId}|${choice.logicalId}`} value={`${choice.templateId}|${choice.logicalId}`}>{choice.label}</option>)}</select></label><label>Local child template<select value={resolution.disposition === 'associate' ? resolution.childTemplateId ?? '' : ''} onChange={(event) => updateNested(index, event.target.value ? { disposition: 'associate', childTemplateId: event.target.value, confirmed: false } : { disposition: 'leave-unresolved', childTemplateId: undefined, confirmed: false })}><option value="">No local child — preserve TemplateURL</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.childTemplateId}>{analysis.templates.find((template) => template.id === candidate.childTemplateId)?.originalFilename} · {candidate.confidence} · {candidate.evidence.join(' ')}</option>)}</select></label><label className="confirmation"><input type="checkbox" checked={resolution.confirmed} onChange={(event) => updateNested(index, { confirmed: event.target.checked })} />I confirm this parent/child association.</label></fieldset>;
        })}{plan.deploymentGroups.filter((group): group is StackSetDeploymentGroup => group.kind === 'stackset').map((group) => <section key={group.id}><h3>{group.name} targets</h3><StackSetTargetEditor group={stackSetEdits[group.id] ?? group} onChange={updateStackSet} /></section>)}</div>}
        {step === 4 && plan && <div className="preview-grid"><section><h3>Import summary</h3><dl className="metric-grid"><div><dt>Stacks</dt><dd>{plan.summary.stackCount}</dd></div><div><dt>StackSets</dt><dd>{plan.summary.stackSetCount}</dd></div><div><dt>Instances</dt><dd>{plan.summary.instanceCount}</dd></div><div><dt>Resources</dt><dd>{plan.summary.resourceCount}</dd></div><div><dt>Unresolved</dt><dd>{plan.summary.unresolvedReferenceCount}</dd></div><div><dt>Unsupported</dt><dd>{plan.summary.unsupportedResourceCount}</dd></div></dl><h4>Resources by type</h4><ul className="compact-list">{resourceTypes.slice(0, 12).map(([type, count]) => <li key={type}><span>{type}</span><strong>{count}</strong></li>)}</ul></section><section><h3>Diagnostics</h3>{plan.diagnostics.length === 0 ? <p className="success-note">No diagnostics.</p> : <ul className="diagnostic-list">{plan.diagnostics.map((item) => <li key={item.id} className={`severity-${item.severity}`}><strong>{item.code}</strong><span>{item.filename}</span><p>{item.message}</p></li>)}</ul>}</section>{plan.reconciliation && <section className="reimport-diffs"><h3>Resource changes</h3>{plan.reconciliation.resourceDiffs.map((diff) => <details key={diff.resourceKey}><summary><strong>{diff.logicalId}</strong> · {diff.kind} · {diff.propertyChanges.length} property changes</summary><div className="side-by-side-diff"><SourceCodeViewer text={`${JSON.stringify(diff.before ?? {}, null, 2)}\n`} language="json" ariaLabel={`${diff.logicalId} before re-import`} /><SourceCodeViewer text={`${JSON.stringify(diff.after ?? {}, null, 2)}\n`} language="json" ariaLabel={`${diff.logicalId} after re-import`} /></div>{diff.propertyChanges.length > 0 && <ul className="compact-list">{diff.propertyChanges.map((change) => <li key={`${change.kind}-${change.path}`}><strong>{change.kind}</strong><span>{change.path}</span><small>{JSON.stringify(change.before)} → {JSON.stringify(change.after)}</small></li>)}</ul>}</details>)}</section>}</div>}
        {step === 5 && <div className="choice-grid"><label className="choice-card"><input type="radio" name="merge-mode" checked={mergeMode === 'merge'} onChange={() => setMergeMode('merge')} /><strong>Merge into current diagram</strong><span>Preserve existing manual work.</span></label><label className="choice-card"><input type="radio" name="merge-mode" checked={mergeMode === 'replace'} onChange={() => setMergeMode('replace')} /><strong>Create a new document</strong><span>Replace the canvas in one undoable transaction.</span></label><label className="choice-card"><input type="checkbox" checked={autoLayout} onChange={(event) => setAutoLayout(event.target.checked)} /><strong>Run ELK layout</strong><span>Layout newly imported nodes.</span></label>{plan?.reconciliation && <fieldset className="choice-card reimport-policy"><legend>Removed resources</legend><label>Default policy<select value={removedPolicies.defaultPolicy} onChange={(event) => updatePolicies({ ...removedPolicies, defaultPolicy: event.target.value as RemovedResourcePolicy })}><option value="remove">Remove</option><option value="detach">Detach to manual</option><option value="mark-removed">Mark removed</option></select></label>{plan.reconciliation.resourceDiffs.filter((diff) => diff.kind === 'removed').map((diff) => <label key={diff.resourceKey}>{diff.logicalId}<select value={removedPolicies.byResourceKey[diff.resourceKey] ?? removedPolicies.defaultPolicy} onChange={(event) => updatePolicies({ ...removedPolicies, byResourceKey: { ...removedPolicies.byResourceKey, [diff.resourceKey]: event.target.value as RemovedResourcePolicy } })}><option value="remove">Remove</option><option value="detach">Detach to manual</option><option value="mark-removed">Mark removed</option></select></label>)}</fieldset>}</div>}
        {step === 6 && plan && <div className="commit-stage"><h3>Ready to commit</h3><p>The accepted plan is atomic and one-step undoable.</p><div className="summary-strip"><span>{plan.summary.resourceCount} resources</span><span>{plan.summary.stackCount + plan.summary.stackSetCount} definitions</span><span>{plan.summary.instanceCount} instances</span></div>{(blocking || stackSetIssues.length > 0) && <p className="error-note">Resolve blocking association, import, or StackSet target diagnostics before commit.</p>}<button type="button" className="primary-button" onClick={() => void commit()} disabled={blocking || stackSetIssues.length > 0}>Commit import</button></div>}
        {error && <p className="error-note" role="alert">{error}</p>}
        {operation && (operation.kind === 'import' || operation.kind === 'layout') && <div className={`operation-status status-${operation.status}`} role="status" aria-live="polite"><progress max={operation.total || 1} value={operation.completed} aria-label="Import operation progress" /><strong>{operation.phase}</strong><span>{operation.percent !== undefined ? `${operation.percent}%` : `${operation.completed} of ${operation.total}`}</span><p>{operation.message}</p></div>}
      </div>
      <footer className="dialog-footer"><button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}>Back</button><span>Step {step + 1} of {STEPS.length}</span>{step < STEPS.length - 1 && <button type="button" className="primary-button" onClick={() => void nextStep()} disabled={parsing}>Next</button>}</footer>
    </section>
  </div>;
}

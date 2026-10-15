/**
 * @file Editable StackSet desired targets and operation preferences.
 * @module ui/components/StackSetTargetEditor
 */
import { useState } from 'react';
import type { StackSetDeploymentGroup, StackSetOperationPreferences, StackSetTargetGroup } from '../../domain/types';
import { uniqueId } from '../../domain/ids';
import { validateStackSetTargets } from '../../cloudformation/stackset';

export interface StackSetTargetEditorProps {
  readonly group: StackSetDeploymentGroup;
  readonly onChange: (group: StackSetDeploymentGroup) => void;
}

function list(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))];
}

function replaceTarget(group: StackSetDeploymentGroup, targetId: string, patch: Partial<StackSetTargetGroup>): StackSetDeploymentGroup {
  return { ...group, targetGroups: group.targetGroups.map((target) => target.id === targetId ? { ...target, ...patch } : target), unresolvedTargets: false };
}

function numeric(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Renders repeatable target groups and AWS-compatible operation preference controls. */
export function StackSetTargetEditor({ group, onChange }: StackSetTargetEditorProps) {
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const issues = validateStackSetTargets(group.permissionModel, group.targetGroups, group.operationPreferences);
  const updatePreferences = (patch: Partial<StackSetOperationPreferences>): void => onChange({ ...group, operationPreferences: { ...group.operationPreferences, ...patch } });
  return <div className="stackset-target-editor">
    <div className="form-grid">
      <label>Permission model<select value={group.permissionModel ?? ''} onChange={(event) => onChange({ ...group, permissionModel: event.target.value || undefined })}><option value="">Unknown</option><option value="SELF_MANAGED">Self-managed</option><option value="SERVICE_MANAGED">Service-managed</option></select></label>
    </div>
    <div className="target-editor-heading"><h4>Target groups</h4><button type="button" onClick={() => onChange({ ...group, targetGroups: [...group.targetGroups, { id: uniqueId('stackset-target'), accounts: [], organizationalUnitIds: [], regions: [], parameterOverrides: {} }], unresolvedTargets: false })}>Add target group</button></div>
    {group.targetGroups.length === 0 && <p className="form-note">No desired targets are defined. Imported stack instances remain available as observed deployments.</p>}
    {group.targetGroups.map((target, index) => <fieldset className="stackset-target-card" key={target.id}><legend>Target group {index + 1}</legend>
      <button type="button" className="danger-link" onClick={() => onChange({ ...group, targetGroups: group.targetGroups.filter((item) => item.id !== target.id), unresolvedTargets: group.targetGroups.length === 1 })}>Remove</button>
      <label>Accounts<textarea defaultValue={target.accounts.join('\n')} onBlur={(event) => onChange(replaceTarget(group, target.id, { accounts: list(event.target.value) }))} placeholder="111111111111" /></label>
      <label>Organization roots / OUs<textarea defaultValue={target.organizationalUnitIds.join('\n')} onBlur={(event) => onChange(replaceTarget(group, target.id, { organizationalUnitIds: list(event.target.value) }))} placeholder="ou-abcd-12345678" /></label>
      <label>Account filter<select value={target.accountFilterType ?? 'NONE'} onChange={(event) => onChange(replaceTarget(group, target.id, { accountFilterType: event.target.value as StackSetTargetGroup['accountFilterType'] }))}><option value="NONE">None</option><option value="INTERSECTION">Intersection</option><option value="DIFFERENCE">Difference</option><option value="UNION">Union</option></select></label>
      <label>Regions<textarea defaultValue={target.regions.join('\n')} onBlur={(event) => onChange(replaceTarget(group, target.id, { regions: list(event.target.value) }))} placeholder="us-east-1" /></label>
      <label>Parameter overrides<textarea className="json-editor compact-json" defaultValue={JSON.stringify(target.parameterOverrides, null, 2)} onBlur={(event) => {
        try {
          const parsed = JSON.parse(event.target.value) as unknown;
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Overrides must be a JSON object.');
          setJsonErrors((current) => ({ ...current, [target.id]: '' }));
          onChange(replaceTarget(group, target.id, { parameterOverrides: parsed as Record<string, unknown> }));
        } catch (error) { setJsonErrors((current) => ({ ...current, [target.id]: error instanceof Error ? error.message : String(error) })); }
      }} /></label>
      {jsonErrors[target.id] && <p className="error-note" role="alert">{jsonErrors[target.id]}</p>}
    </fieldset>)}
    <fieldset className="operation-preferences"><legend>Deployment preferences</legend>
      <label>Concurrency mode<select value={group.operationPreferences?.concurrencyMode ?? ''} onChange={(event) => updatePreferences({ concurrencyMode: event.target.value ? event.target.value as NonNullable<StackSetOperationPreferences['concurrencyMode']> : undefined })}><option value="">AWS default</option><option value="STRICT_FAILURE_TOLERANCE">Strict failure tolerance</option><option value="SOFT_FAILURE_TOLERANCE">Soft failure tolerance</option></select></label>
      <label>Region concurrency<select value={group.operationPreferences?.regionConcurrencyType ?? ''} onChange={(event) => updatePreferences({ regionConcurrencyType: event.target.value ? event.target.value as NonNullable<StackSetOperationPreferences['regionConcurrencyType']> : undefined })}><option value="">AWS default</option><option value="SEQUENTIAL">Sequential</option><option value="PARALLEL">Parallel</option></select></label>
      <label>Failure tolerance count<input type="number" min="0" value={group.operationPreferences?.failureToleranceCount ?? ''} onChange={(event) => updatePreferences({ failureToleranceCount: numeric(event.target.value), failureTolerancePercentage: undefined })} /></label>
      <label>Failure tolerance percentage<input type="number" min="0" max="100" value={group.operationPreferences?.failureTolerancePercentage ?? ''} onChange={(event) => updatePreferences({ failureTolerancePercentage: numeric(event.target.value), failureToleranceCount: undefined })} /></label>
      <label>Maximum concurrent count<input type="number" min="1" value={group.operationPreferences?.maxConcurrentCount ?? ''} onChange={(event) => updatePreferences({ maxConcurrentCount: numeric(event.target.value), maxConcurrentPercentage: undefined })} /></label>
      <label>Maximum concurrent percentage<input type="number" min="0" max="100" value={group.operationPreferences?.maxConcurrentPercentage ?? ''} onChange={(event) => updatePreferences({ maxConcurrentPercentage: numeric(event.target.value), maxConcurrentCount: undefined })} /></label>
      <label>Region order<textarea value={group.operationPreferences?.regionOrder?.join('\n') ?? ''} onChange={(event) => updatePreferences({ regionOrder: list(event.target.value) })} /></label>
    </fieldset>
    {issues.length > 0 && <ul className="diagnostic-list">{issues.map((issue) => <li key={`${issue.path}-${issue.message}`} className="severity-error"><strong>{issue.path}</strong><p>{issue.message}</p></li>)}</ul>}
  </div>;
}

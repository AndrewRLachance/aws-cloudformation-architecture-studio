import { useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore';
import { useShallow } from 'zustand/react/shallow';

export function BulkInspector({ nodeIds }: { readonly nodeIds: readonly string[] }) {
  const document = useDiagramStore((state) => state.document); const actions = useDiagramStore(useShallow((state) => ({ bulkSetStack: state.bulkSetStack, bulkUpdateMembership: state.bulkUpdateMembership, bulkSetDiagramTag: state.bulkSetDiagramTag, bulkSetCloudFormationTag: state.bulkSetCloudFormationTag })));
  const [tagKey, setTagKey] = useState(''); const [tagValue, setTagValue] = useState(''); const [membership, setMembership] = useState('');
  const stackIds = [...new Set(nodeIds.map((id) => document.nodesById[id]?.stackId ?? ''))];
  const groups = document.logicalGroupOrder.map((id) => document.logicalGroupsById[id]).filter((group): group is NonNullable<typeof group> => group !== undefined);
  const controls = document.nodeOrder.map((id) => document.nodesById[id]).filter((node): node is NonNullable<typeof node> => node?.kind === 'control');
  const securityGroups = document.nodeOrder.map((id) => document.nodesById[id]).filter((node): node is NonNullable<typeof node> => node?.kind === 'aws-resource' && node.resourceType === 'security-group');
  const membershipEditor = (label: string, field: 'logicalGroupIds' | 'attachedControlIds' | 'securityGroupIds', options: readonly { id: string; name: string }[]) => <fieldset className="bulk-field"><legend>{label}</legend><select value={membership} onChange={(event) => setMembership(event.target.value)}><option value="">Choose…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><div><button type="button" disabled={!membership} onClick={() => actions.bulkUpdateMembership(field, [membership], 'add')}>Add</button><button type="button" disabled={!membership} onClick={() => actions.bulkUpdateMembership(field, [membership], 'remove')}>Remove</button><button type="button" disabled={!membership} onClick={() => actions.bulkUpdateMembership(field, [membership], 'replace')}>Replace</button></div></fieldset>;
  return <div className="inspector-content bulk-inspector"><h3>{nodeIds.length} nodes selected</h3><p>Mixed values are preserved unless explicitly changed.</p>
    <label>Stack ownership<select value={stackIds.length === 1 ? stackIds[0] : ''} onChange={(event) => actions.bulkSetStack(event.target.value || undefined)}><option value="">{stackIds.length > 1 ? 'Mixed / clear' : 'None'}</option>{document.deploymentGroupOrder.map((id) => document.deploymentGroupsById[id]).filter((group) => group?.kind === 'stack' || group?.kind === 'nested-stack').map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <fieldset className="bulk-field"><legend>Tags</legend><label>Key<input value={tagKey} onChange={(event) => setTagKey(event.target.value)} /></label><label>Value<input value={tagValue} onChange={(event) => setTagValue(event.target.value)} /></label><div><button type="button" disabled={!tagKey.trim()} onClick={() => actions.bulkSetDiagramTag(tagKey, tagValue)}>Set diagram tag</button><button type="button" disabled={!tagKey.trim()} onClick={() => actions.bulkSetDiagramTag(tagKey)}>Remove diagram tag</button><button type="button" disabled={!tagKey.trim()} onClick={() => void actions.bulkSetCloudFormationTag(tagKey, tagValue)}>Set CloudFormation tag</button><button type="button" disabled={!tagKey.trim()} onClick={() => void actions.bulkSetCloudFormationTag(tagKey)}>Remove CloudFormation tag</button></div></fieldset>
    {membershipEditor('Logical groups', 'logicalGroupIds', groups)}
    {membershipEditor('Governance controls', 'attachedControlIds', controls)}
    {membershipEditor('Security groups', 'securityGroupIds', securityGroups)}
  </div>;
}

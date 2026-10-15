import { useMemo, useState } from 'react';
import { useDiagramStore } from '../../store/useDiagramStore';
import { nodeAwsService } from '../../domain/filters';
import { uniqueId } from '../../domain/ids';
import type { SavedFilter } from '../../domain/types';

const values = (text: string): string[] => [...new Set(text.split(',').map((value) => value.trim()).filter(Boolean))];

export function FilterBar() {
  const document = useDiagramStore((state) => state.document);
  const saveFilter = useDiagramStore((state) => state.saveFilter); const deleteFilter = useDiagramStore((state) => state.deleteFilter); const setActiveFilter = useDiagramStore((state) => state.setActiveFilter);
  const [name, setName] = useState(''); const [accounts, setAccounts] = useState(''); const [regions, setRegions] = useState(''); const [stacks, setStacks] = useState(''); const [stackSets, setStackSets] = useState(''); const [services, setServices] = useState(''); const [statuses, setStatuses] = useState('');
  const options = useMemo(() => ({
    accounts: [...new Set([...Object.values(document.deploymentGroupsById).flatMap((group) => group.kind === 'stack' && group.accountId ? [group.accountId] : []), ...Object.values(document.nodesById).flatMap((node) => node.kind === 'boundary' && node.accountId ? [node.accountId] : [])])],
    regions: [...new Set([...Object.values(document.deploymentGroupsById).flatMap((group) => group.kind === 'stack' && group.region ? [group.region] : []), ...Object.values(document.nodesById).flatMap((node) => node.kind === 'boundary' && node.regionName ? [node.regionName] : [])])],
    services: [...new Set(Object.values(document.nodesById).map(nodeAwsService).filter((value): value is string => Boolean(value)))].sort(),
  }), [document]);
  return <div className="filter-bar">
    <label>Filter<select aria-label="Active saved filter" value={document.activeFilterId ?? ''} onChange={(event) => setActiveFilter(event.target.value || undefined)}><option value="">All architecture</option>{document.savedFilterOrder.map((id) => document.savedFiltersById[id]).filter((filter): filter is SavedFilter => filter !== undefined).map((filter) => <option key={filter.id} value={filter.id}>{filter.name}</option>)}</select></label>
    <details><summary>Manage filters</summary><div className="filter-editor">
      <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Accounts<input list="filter-accounts" value={accounts} onChange={(event) => setAccounts(event.target.value)} placeholder="comma separated" /></label><datalist id="filter-accounts">{options.accounts.map((value) => <option key={value} value={value} />)}</datalist>
      <label>Regions<input list="filter-regions" value={regions} onChange={(event) => setRegions(event.target.value)} placeholder="comma separated" /></label><datalist id="filter-regions">{options.regions.map((value) => <option key={value} value={value} />)}</datalist>
      <label>Stack IDs<input value={stacks} onChange={(event) => setStacks(event.target.value)} placeholder="comma separated" /></label>
      <label>StackSet IDs<input value={stackSets} onChange={(event) => setStackSets(event.target.value)} placeholder="comma separated" /></label>
      <label>AWS services<input list="filter-services" value={services} onChange={(event) => setServices(event.target.value)} placeholder="comma separated" /></label><datalist id="filter-services">{options.services.map((value) => <option key={value} value={value} />)}</datalist>
      <label>Validation<input value={statuses} onChange={(event) => setStatuses(event.target.value)} placeholder="valid, warning, error, unresolved" /></label>
      <button type="button" onClick={() => { const clean = name.trim(); if (!clean) return; const id = uniqueId('filter'); saveFilter({ id, name: clean, criteria: { accountIds: values(accounts), regions: values(regions), stackIds: values(stacks), stackSetIds: values(stackSets), awsServices: values(services), validationStatuses: values(statuses).filter((value): value is 'valid' | 'warning' | 'error' | 'unresolved' => ['valid','warning','error','unresolved'].includes(value)) } }); setActiveFilter(id); setName(''); }}>Save filter</button>
      {document.activeFilterId && <button type="button" onClick={() => deleteFilter(document.activeFilterId!)}>Delete active filter</button>}
    </div></details>
  </div>;
}

/** Document-local saved filter evaluation with containment context. */
import type { DiagramDocument, DiagramNode, SavedFilter, ValidationIssue } from './types';

function ancestry(document: DiagramDocument, node: DiagramNode): DiagramNode[] {
  const values: DiagramNode[] = [node]; let current = node; const seen = new Set<string>();
  while (current.physicalParentId && !seen.has(current.physicalParentId)) { seen.add(current.physicalParentId); const parent = document.nodesById[current.physicalParentId]; if (!parent) break; values.push(parent); current = parent; }
  return values;
}

export function nodeAwsService(node: DiagramNode): string | undefined {
  const type = node.kind === 'aws-resource' ? node.cloudFormationType : node.kind === 'boundary' ? node.cloudFormation?.type : undefined;
  return type?.split('::')[1] ?? (node.kind === 'aws-resource' ? node.resourceType : undefined);
}

function nodeStatus(node: DiagramNode, issues: readonly ValidationIssue[]): 'valid' | 'warning' | 'error' | 'unresolved' {
  const relevant = issues.filter((issue) => issue.nodeId === node.id || issue.templateId && issue.templateId === node.sourceTemplateId);
  if (relevant.some((issue) => issue.severity === 'error')) return 'error';
  if (relevant.some((issue) => issue.severity === 'warning')) return 'warning';
  if (node.placementConfidence === 'unresolved' || node.importStatus === 'removed') return 'unresolved';
  return 'valid';
}

function intersects(values: readonly string[], accepted: readonly string[]): boolean { return accepted.length === 0 || values.some((value) => accepted.includes(value)); }

export function nodeMatchesFilter(document: DiagramDocument, node: DiagramNode, filter: SavedFilter, issues: readonly ValidationIssue[]): boolean {
  if (node.kind === 'text' || node.kind === 'legend') return true;
  const chain = ancestry(document, node);
  const stack = node.stackId ? document.deploymentGroupsById[node.stackId] : undefined;
  const accounts = [...chain.flatMap((item) => item.kind === 'boundary' && item.accountId ? [item.accountId] : []), ...(stack?.kind === 'stack' && stack.accountId ? [stack.accountId] : [])];
  const regions = [...chain.flatMap((item) => item.kind === 'boundary' && item.regionName ? [item.regionName] : []), ...(stack?.kind === 'stack' && stack.region ? [stack.region] : [])];
  const services = [nodeAwsService(node)].filter((value): value is string => Boolean(value));
  const criteria = filter.criteria;
  return intersects(accounts, criteria.accountIds)
    && intersects(regions, criteria.regions)
    && intersects(node.stackId ? [node.stackId] : [], criteria.stackIds)
    && intersects(node.stackSetId ? [node.stackSetId] : [], criteria.stackSetIds)
    && intersects(services, criteria.awsServices)
    && intersects([nodeStatus(node, issues)], criteria.validationStatuses);
}

/** Returns matched nodes plus every physical ancestor needed to retain context. */
export function visibleNodeIds(document: DiagramDocument, issues: readonly ValidationIssue[]): Set<string> {
  const filter = document.activeFilterId ? document.savedFiltersById[document.activeFilterId] : undefined;
  if (!filter) return new Set(document.nodeOrder);
  const visible = new Set<string>();
  for (const node of Object.values(document.nodesById)) if (nodeMatchesFilter(document, node, filter, issues)) {
    visible.add(node.id);
    let parentId = node.physicalParentId;
    while (parentId && !visible.has(parentId)) { visible.add(parentId); parentId = document.nodesById[parentId]?.physicalParentId; }
  }
  return visible;
}

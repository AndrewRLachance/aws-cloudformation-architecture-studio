/**
 * @file Offline CloudFormation semantic validation.
 * @module cloudformation/validation
 */
import type { CloudFormationTemplateRecord, DiagramDocument, ValidationIssue } from '../domain/types';
import { stableId } from '../domain/ids';
import { analyzeIntrinsicReferences } from './dependency';
import { evaluateStaticExpression, expressionFingerprint, isRecord } from './fidelity';

/** AWS CloudFormation limits verified against the documentation on 2026-10-15. */
export const CLOUDFORMATION_LIMITS = {
  resources: 500,
  parameters: 200,
  mappings: 200,
  mappingAttributes: 200,
  outputs: 200,
  logicalIdLength: 255,
  descriptionBytes: 1_024,
  parameterValueBytes: 4_096,
  directTemplateBodyBytes: 51_200,
  s3TemplateBodyBytes: 1_048_576,
  nestedOperationResources: 2_500,
} as const;

function issue(template: CloudFormationTemplateRecord, severity: ValidationIssue['severity'], code: string, message: string, path?: string): ValidationIssue {
  return { id: stableId('cfn-validation', template.id, code, path ?? '', message), severity, code, message, templateId: template.id, filename: template.originalFilename, ...(path ? { path } : {}) };
}

function byteLength(value: string): number { return new TextEncoder().encode(value).length; }

function limit(template: CloudFormationTemplateRecord, issues: ValidationIssue[], name: string, count: number, maximum: number, path: string): void {
  if (count > maximum) issues.push(issue(template, 'error', `STACK_LIMIT_${name.toUpperCase()}`, `${name} count ${count} exceeds the CloudFormation limit of ${maximum}.`, path));
}

function detectCycles(template: CloudFormationTemplateRecord): string[][] {
  const graph = new Map<string, Set<string>>();
  for (const logicalId of Object.keys(template.fidelity.projectedResources)) graph.set(logicalId, new Set());
  for (const reference of analyzeIntrinsicReferences(template)) if (!reference.external && graph.has(reference.sourceLogicalId) && graph.has(reference.target)) graph.get(reference.sourceLogicalId)?.add(reference.target);
  const indexByNode = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  let index = 0;
  const visit = (node: string): void => {
    indexByNode.set(node, index); lowLink.set(node, index); index += 1; stack.push(node); onStack.add(node);
    for (const target of graph.get(node) ?? []) {
      if (!indexByNode.has(target)) { visit(target); lowLink.set(node, Math.min(lowLink.get(node) ?? 0, lowLink.get(target) ?? 0)); }
      else if (onStack.has(target)) lowLink.set(node, Math.min(lowLink.get(node) ?? 0, indexByNode.get(target) ?? 0));
    }
    if (lowLink.get(node) !== indexByNode.get(node)) return;
    const component: string[] = [];
    let member: string | undefined;
    do { member = stack.pop(); if (member) { onStack.delete(member); component.push(member); } } while (member && member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) cycles.push(component.sort());
  };
  for (const node of graph.keys()) if (!indexByNode.has(node)) visit(node);
  return cycles;
}

/** Validates one canonical template using only locally observable information. */
export function validateTemplateSemantics(template: CloudFormationTemplateRecord): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const resources = template.fidelity.projectedResources;
  limit(template, issues, 'resources', Object.keys(resources).length, CLOUDFORMATION_LIMITS.resources, 'Resources');
  limit(template, issues, 'parameters', Object.keys(template.parameters).length, CLOUDFORMATION_LIMITS.parameters, 'Parameters');
  limit(template, issues, 'mappings', Object.keys(template.mappings).length, CLOUDFORMATION_LIMITS.mappings, 'Mappings');
  limit(template, issues, 'outputs', Object.keys(template.fidelity.projectedOutputs).length, CLOUDFORMATION_LIMITS.outputs, 'Outputs');
  for (const [name, mapping] of Object.entries(template.mappings)) if (isRecord(mapping)) for (const [topKey, attributes] of Object.entries(mapping)) if (isRecord(attributes) && Object.keys(attributes).length > CLOUDFORMATION_LIMITS.mappingAttributes) issues.push(issue(template, 'error', 'STACK_LIMIT_MAPPING_ATTRIBUTES', `Mapping ${name}.${topKey} has ${Object.keys(attributes).length} attributes; the limit is ${CLOUDFORMATION_LIMITS.mappingAttributes}.`, `Mappings.${name}.${topKey}`));
  for (const logicalId of Object.keys(resources)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(logicalId)) issues.push(issue(template, 'error', 'INVALID_LOGICAL_ID', `${logicalId} is not a valid alphanumeric logical ID beginning with a letter.`, `Resources.${logicalId}`));
    if (logicalId.length > CLOUDFORMATION_LIMITS.logicalIdLength) issues.push(issue(template, 'error', 'LOGICAL_ID_TOO_LONG', `${logicalId} exceeds ${CLOUDFORMATION_LIMITS.logicalIdLength} characters.`, `Resources.${logicalId}`));
  }
  for (const [sectionName, section] of [['Parameters', template.parameters], ['Mappings', template.mappings], ['Outputs', template.fidelity.projectedOutputs]] as const) for (const name of Object.keys(section)) {
    if (!/^[A-Za-z0-9]+$/.test(name)) issues.push(issue(template, 'error', `INVALID_${sectionName.toUpperCase()}_NAME`, `${sectionName} name ${name} must be alphanumeric.`, `${sectionName}.${name}`));
    if (name.length > CLOUDFORMATION_LIMITS.logicalIdLength) issues.push(issue(template, 'error', `${sectionName.toUpperCase()}_NAME_TOO_LONG`, `${sectionName} name ${name} exceeds ${CLOUDFORMATION_LIMITS.logicalIdLength} characters.`, `${sectionName}.${name}`));
  }
  if (template.description && byteLength(template.description) > CLOUDFORMATION_LIMITS.descriptionBytes) issues.push(issue(template, 'error', 'DESCRIPTION_TOO_LARGE', `Template description exceeds ${CLOUDFORMATION_LIMITS.descriptionBytes} bytes.`, 'Description'));
  for (const [name, raw] of Object.entries(template.parameters)) if (isRecord(raw) && typeof raw.Default === 'string' && byteLength(raw.Default) > CLOUDFORMATION_LIMITS.parameterValueBytes) issues.push(issue(template, 'error', 'PARAMETER_DEFAULT_TOO_LARGE', `Default for ${name} exceeds ${CLOUDFORMATION_LIMITS.parameterValueBytes} bytes.`, `Parameters.${name}.Default`));
  const templateBytes = byteLength(template.originalSourceText);
  if (templateBytes > CLOUDFORMATION_LIMITS.s3TemplateBodyBytes) issues.push(issue(template, 'error', 'TEMPLATE_TOO_LARGE', `Template is ${templateBytes} bytes; the S3-backed maximum is ${CLOUDFORMATION_LIMITS.s3TemplateBodyBytes}.`, '$'));
  else if (templateBytes > CLOUDFORMATION_LIMITS.directTemplateBodyBytes) issues.push(issue(template, 'warning', 'TEMPLATE_REQUIRES_S3', `Template is ${templateBytes} bytes and must be submitted through S3 rather than as a direct request body.`, '$'));
  for (const cycle of detectCycles(template)) issues.push(issue(template, 'error', 'CYCLIC_DEPENDENCY', `Resource dependency cycle: ${cycle.join(' → ')} → ${cycle[0]}.`, 'Resources'));
  if (template.fidelity.confidence === 'partial') issues.push(issue(template, 'warning', 'TRANSFORM_ANALYSIS_INCOMPLETE', 'One or more transforms could not be executed locally; dependency and post-transform quota analysis is incomplete.', 'Transform'));
  issues.push(...template.parseDiagnostics.filter((diagnostic) => diagnostic.severity !== 'info').map((diagnostic) => issue(template, diagnostic.severity, diagnostic.code, diagnostic.message, diagnostic.path)));
  issues.push(...template.fidelity.transformDiagnostics.filter((diagnostic) => diagnostic.severity !== 'info').map((diagnostic) => issue(template, diagnostic.severity, diagnostic.code, diagnostic.message, diagnostic.path)));
  return issues;
}

function exportExpression(raw: unknown): unknown | undefined { return isRecord(raw) && isRecord(raw.Export) ? raw.Export.Name : undefined; }

function stackDependencyCycles(document: DiagramDocument): Array<{ groups: string[]; edgeIds: string[] }> {
  const graph = new Map<string, Set<string>>();
  const relevantEdges = Object.values(document.edgesById).filter((edge) => edge.relationshipType === 'imports-cloudformation-output' && document.nodesById[edge.target]?.kind !== 'external-reference');
  for (const edge of relevantEdges) {
    const source = document.nodesById[edge.source];
    const target = document.nodesById[edge.target];
    const sourceOwner = source?.stackId ?? source?.stackSetId;
    const targetOwner = target?.stackId ?? target?.stackSetId;
    if (!sourceOwner || !targetOwner || sourceOwner === targetOwner) continue;
    if (!graph.has(sourceOwner)) graph.set(sourceOwner, new Set());
    if (!graph.has(targetOwner)) graph.set(targetOwner, new Set());
    graph.get(sourceOwner)?.add(targetOwner);
  }
  const indexes = new Map<string, number>();
  const lows = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  let next = 0;
  const visit = (groupId: string): void => {
    indexes.set(groupId, next); lows.set(groupId, next); next += 1; stack.push(groupId); active.add(groupId);
    for (const target of graph.get(groupId) ?? []) {
      if (!indexes.has(target)) { visit(target); lows.set(groupId, Math.min(lows.get(groupId) ?? 0, lows.get(target) ?? 0)); }
      else if (active.has(target)) lows.set(groupId, Math.min(lows.get(groupId) ?? 0, indexes.get(target) ?? 0));
    }
    if (lows.get(groupId) !== indexes.get(groupId)) return;
    const component: string[] = [];
    let member: string | undefined;
    do { member = stack.pop(); if (member) { active.delete(member); component.push(member); } } while (member && member !== groupId);
    if (component.length > 1) components.push(component.sort());
  };
  for (const groupId of graph.keys()) if (!indexes.has(groupId)) visit(groupId);
  return components.map((groups) => {
    const groupSet = new Set(groups);
    return { groups, edgeIds: relevantEdges.filter((edge) => {
      const source = document.nodesById[edge.source]; const target = document.nodesById[edge.target];
      return groupSet.has(source?.stackId ?? source?.stackSetId ?? '') && groupSet.has(target?.stackId ?? target?.stackSetId ?? '');
    }).map((edge) => edge.id) };
  });
}

function generatedOutputId(targetLogicalId: string, exportName: string): string {
  const cleaned = `${targetLogicalId}${exportName}Export`.replace(/[^A-Za-z0-9]/g, '');
  return (/^[A-Za-z]/.test(cleaned) ? cleaned : `Resource${cleaned}`).slice(0, 240);
}

/** Validates all templates and cross-stack semantics in a diagram document. */
export function validateCloudFormationDocument(document: DiagramDocument): ValidationIssue[] {
  const issues = document.templateOrder.flatMap((id) => document.templatesById[id] ? validateTemplateSemantics(document.templatesById[id]) : []);
  const exportOwners = new Map<string, string>();
  for (const group of Object.values(document.deploymentGroupsById)) {
    if (!group.templateId) continue;
    const template = document.templatesById[group.templateId];
    if (!template) continue;
    if (group.kind === 'stackset' && group.permissionModel === 'SERVICE_MANAGED' && template.fidelity.dialects.some((dialect) => dialect === 'macro' || dialect === 'sam' || dialect === 'language-extensions')) issues.push(issue(template, 'error', 'SERVICE_MANAGED_STACKSET_MACRO', 'Service-managed StackSets cannot use templates containing macros or transforms.', 'Transform'));
    const stack = group.kind === 'stack' ? group : undefined;
    const parameterDefaults = Object.fromEntries(Object.entries(template.parameters).flatMap(([name, raw]) => isRecord(raw) && 'Default' in raw ? [[name, raw.Default]] : []));
    for (const [outputId, output] of Object.entries(template.fidelity.projectedOutputs)) {
      const expression = exportExpression(output); if (expression === undefined) continue;
      const resolved = evaluateStaticExpression(expression, { parameters: parameterDefaults, mappings: template.mappings, pseudoParameters: { 'AWS::StackName': group.name, 'AWS::AccountId': stack?.accountId ?? '', 'AWS::Region': stack?.region ?? '', 'AWS::Partition': 'aws' } });
      const name = resolved ?? expressionFingerprint(expression);
      const scope = `${stack?.accountId ?? 'unknown'}|${stack?.region ?? 'unknown'}|${name}`;
      const previous = exportOwners.get(scope);
      if (previous) issues.push(issue(template, stack?.accountId && stack.region && stack.accountId !== 'unresolved' && stack.region !== 'unresolved' ? 'error' : 'warning', 'DUPLICATE_EXPORT_NAME', `Export ${name} is also declared by ${previous}${stack?.accountId && stack.region ? ' in the same account and Region' : '; account/Region scope is unresolved'}.`, `Outputs.${outputId}.Export.Name`));
      else exportOwners.set(scope, template.originalFilename);
    }
    if (group.kind === 'stack' && group.name.length > 128) issues.push(issue(template, 'error', 'STACK_NAME_TOO_LONG', `${group.name} exceeds the 128-character CloudFormation stack-name limit.`, 'StackName'));
    if (group.kind === 'stack' && !/^[A-Za-z][A-Za-z0-9-]*$/.test(group.name)) issues.push(issue(template, 'error', 'INVALID_STACK_NAME', `${group.name} is not a valid CloudFormation stack name.`, 'StackName'));
  }
  for (const edge of Object.values(document.edgesById)) if (edge.relationshipType === 'imports-cloudformation-output' && edge.validationStatus === 'error') issues.push({ id: stableId('cfn-validation', edge.id, 'UNSUPPORTED_CROSS_CONTEXT_REFERENCE'), severity: 'error', code: 'UNSUPPORTED_CROSS_CONTEXT_REFERENCE', message: edge.description ?? 'Fn::ImportValue cannot cross accounts or Regions.', edgeId: edge.id, path: edge.sourcePropertyPath, templateId: edge.sourceTemplateId });
  for (const cycle of stackDependencyCycles(document)) for (const edgeId of cycle.edgeIds) {
    const edge = document.edgesById[edgeId];
    if (!edge) continue;
    const names = cycle.groups.map((id) => document.deploymentGroupsById[id]?.name ?? id);
    issues.push({ id: stableId('cfn-validation', edgeId, 'CYCLIC_STACK_DEPENDENCY'), severity: 'error', code: 'CYCLIC_STACK_DEPENDENCY', message: `Resolved stack dependency cycle includes ${names.join(' → ')}.`, edgeId, path: edge.sourcePropertyPath, templateId: edge.sourceTemplateId });
  }
  const generatedOutputs = new Map<string, string>();
  for (const edge of Object.values(document.edgesById)) {
    if (edge.sourceTemplateId || !edge.sourcePropertyPath) continue;
    const source = document.nodesById[edge.source]; const target = document.nodesById[edge.target];
    const sourceOwner = source?.stackId ?? source?.stackSetId; const targetOwner = target?.stackId ?? target?.stackSetId;
    if (!sourceOwner || !targetOwner || sourceOwner === targetOwner) continue;
    const targetLogicalId = target?.sourceLogicalId ?? target?.name.replace(/[^A-Za-z0-9]/g, '');
    if (!targetLogicalId) continue;
    const provider = document.deploymentGroupsById[targetOwner];
    const exportName = typeof edge.metadata.exportName === 'string' ? edge.metadata.exportName : edge.label && !edge.label.startsWith('Fn::') && edge.label !== 'Ref' ? edge.label : `${provider?.name ?? targetOwner}-${targetLogicalId}`.replace(/[^A-Za-z0-9:_./-]/g, '-');
    const outputId = generatedOutputId(targetLogicalId, exportName);
    const key = `${targetOwner}|${outputId}`;
    const previous = generatedOutputs.get(key);
    if (previous && previous !== edge.id) issues.push({ id: stableId('cfn-validation', edge.id, 'GENERATED_OUTPUT_ID_COLLISION'), severity: 'error', code: 'GENERATED_OUTPUT_ID_COLLISION', message: `Multiple relationships generate output logical ID ${outputId} in ${provider?.name ?? targetOwner}.`, edgeId: edge.id, path: `Outputs.${outputId}` });
    else generatedOutputs.set(key, edge.id);
  }
  for (const group of Object.values(document.deploymentGroupsById)) {
    const logicalIds = new Map<string, string>();
    for (const nodeId of group.nodeIds) {
      const node = document.nodesById[nodeId]; if (!node || node.sourceProjection) continue;
      if (node.kind !== 'aws-resource' && !(node.kind === 'boundary' && node.cloudFormation)) continue;
      const logicalId = node.sourceLogicalId ?? node.name.replace(/[^A-Za-z0-9]/g, '');
      const previous = logicalIds.get(logicalId);
      if (previous && previous !== node.id) issues.push({ id: stableId('cfn-validation', group.id, 'GENERATED_LOGICAL_ID_COLLISION', logicalId), severity: 'error', code: 'GENERATED_LOGICAL_ID_COLLISION', message: `${group.name} contains multiple resources that generate logical ID ${logicalId}.`, nodeId: node.id, path: `Resources.${logicalId}` });
      else logicalIds.set(logicalId, node.id);
    }
  }
  const nestedResources = Object.values(document.deploymentGroupsById).filter((group) => group.kind === 'nested-stack' && group.templateId).reduce((sum, group) => sum + Object.keys(document.templatesById[group.templateId ?? '']?.fidelity.projectedResources ?? {}).length, 0);
  if (nestedResources > CLOUDFORMATION_LIMITS.nestedOperationResources) issues.push({ id: stableId('cfn-validation', document.id, 'NESTED_OPERATION_LIMIT'), severity: 'error', code: 'NESTED_OPERATION_LIMIT', message: `Associated nested stacks contain ${nestedResources} resources; one operation supports at most ${CLOUDFORMATION_LIMITS.nestedOperationResources}.`, path: 'deploymentGroupsById' });
  return issues;
}

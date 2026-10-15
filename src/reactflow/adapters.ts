/**
 * @file Domain-to-React Flow adapter functions.
 * @module reactflow/adapters
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file maps persisted nodes and edges into visible React Flow node and edge objects.
 */
import type { Edge, Node } from '@xyflow/react';
import type { DiagramDocument, DiagramNode, LayerId, SelectionState, ValidationIssue } from '../domain/types';
import { sortParentBeforeChild } from '../domain/coordinates';
import { nodeAwsService, visibleNodeIds } from '../domain/filters';

/** React Flow node payload that carries the source domain node. */
export interface FlowNodeData extends Record<string, unknown> {
  readonly domain: DiagramNode;
  readonly badges: readonly string[];
  readonly legendEntries?: readonly Readonly<{ label: string; color: string; symbol?: string }>[];
}
/** React Flow node type used by the architecture canvas. */
export type ArchitectureFlowNode = Node<FlowNodeData, 'boundary' | 'resource' | 'control' | 'external' | 'text' | 'legend'>;
/** React Flow edge payload derived from a semantic diagram edge. */
export interface FlowEdgeData extends Record<string, unknown> {
  readonly relationshipType: string;
  readonly description?: string;
  readonly protocol?: string;
  readonly port?: string;
  readonly validationStatus: string;
}
/** React Flow edge type used by the architecture canvas. */
export type ArchitectureFlowEdge = Edge<FlowEdgeData, 'semantic'>;

/** Chooses the visual layer for a domain node. */
function nodeLayer(node: DiagramNode): LayerId {
  if (node.kind === 'text' || node.kind === 'legend') return 'labels-metadata';
  if (node.kind === 'boundary') return ['organization','organizational-unit','account'].includes(node.boundaryType) ? 'administrative-boundaries' : 'network-boundaries';
  if (node.kind === 'external-reference') return 'external-references';
  if (node.kind === 'control' || node.kind === 'aws-resource' && ['iam-role','iam-policy'].includes(node.resourceType)) return 'iam-governance';
  if (node.kind === 'aws-resource' && node.resourceType === 'security-group') return 'security-groups';
  return 'aws-resources';
}
/** Chooses the visual layer for a semantic edge relationship type. */
function edgeLayer(type: string): LayerId {
  if (['network-traffic','routes-through','permits-access','denies-access'].includes(type)) return 'network-traffic';
  if (['reads-from','writes-to','publishes-event','subscribes-to-event','replicates-to'].includes(type)) return 'data-flow';
  if (['depends-on','imports-cloudformation-output','deploys-to','stackset-manages-stack-instance','nested-stack'].includes(type)) return 'deployment-dependencies';
  return 'labels-metadata';
}
/** Builds compact node badges from deployment, security, and import metadata. */
function badges(node: DiagramNode, document: DiagramDocument): string[] {
  const values: string[] = [];
  if (node.stackId) values.push(document.deploymentGroupsById[node.stackId]?.name ?? 'Stack');
  if (node.stackSetId) values.push(document.deploymentGroupsById[node.stackSetId]?.name ?? 'StackSet');
  if (node.stackInstanceId) values.push('Stack instance');
  if (node.securityGroupIds.length > 0) values.push(`${node.securityGroupIds.length} SG`);
  if (node.attachedControlIds.length > 0) values.push(`${node.attachedControlIds.length} controls`);
  if (node.importStatus) values.push(node.importStatus);
  if (node.sourceProjection) values.push('Fn::ForEach projection');
  if (node.cdkHelper) values.push('CDK helper');
  else if (node.cdkConstructPath) values.push('CDK');
  if (node.placementConfidence && node.placementConfidence !== 'high') values.push(`${node.placementConfidence} placement`);
  return values;
}

/** Converts visible domain nodes into React Flow nodes. */
export function documentToFlowNodes(document: DiagramDocument, selection: SelectionState, issues: readonly ValidationIssue[] = []): ArchitectureFlowNode[] {
  const selected = new Set(selection.nodeIds);
  const visible = visibleNodeIds(document, issues);
  const services = [...new Set(document.nodeOrder.filter((id) => visible.has(id)).map((id) => document.nodesById[id]).filter((node): node is DiagramNode => Boolean(node)).map(nodeAwsService).filter((value): value is string => Boolean(value)))].sort().map((service) => ({ label: service, color: '#527fff', symbol: 'AWS' }));
  const relationships = [...new Set(document.edgeOrder.map((id) => document.edgesById[id]).filter((edge) => edge && visible.has(edge.source) && visible.has(edge.target)).map((edge) => edge!.relationshipType))].sort().map((relationship) => ({ label: relationship.replaceAll('-', ' '), color: '#d97706', symbol: '→' }));
  const automaticLegendEntries = [...services, ...relationships];
  return sortParentBeforeChild(document).flatMap((id) => {
    const node = document.nodesById[id];
    if (!node || !visible.has(id) || !document.visibleLayers[nodeLayer(node)]) return [];
    const type: ArchitectureFlowNode['type'] = node.kind === 'boundary' ? 'boundary' : node.kind === 'aws-resource' ? 'resource' : node.kind === 'control' ? 'control' : node.kind === 'external-reference' ? 'external' : node.kind;
    return [{
      id: node.id,
      type,
      position: node.position,
      width: node.size.width,
      height: node.size.height,
      data: { domain: node, badges: badges(node, document), ...(node.kind === 'legend' && node.mode === 'automatic' ? { legendEntries: automaticLegendEntries } : {}) },
      selected: selected.has(node.id),
      draggable: !node.locked,
      selectable: true,
      deletable: !node.locked && !node.sourceProjection,
      ...(node.physicalParentId ? { parentId: node.physicalParentId } : {}),
      zIndex: node.zIndex,
      style: { width: node.size.width, height: node.size.height },
      ariaLabel: `${node.name}, ${node.kind}`,
    }];
  });
}

/** Converts visible domain edges into React Flow edges. */
export function documentToFlowEdges(document: DiagramDocument, selection: SelectionState, issues: readonly ValidationIssue[] = []): ArchitectureFlowEdge[] {
  const selected = new Set(selection.edgeIds);
  const visible = visibleNodeIds(document, issues);
  return document.edgeOrder.flatMap((id) => {
    const edge = document.edgesById[id];
    if (!edge || !visible.has(edge.source) || !visible.has(edge.target) || !document.visibleLayers[edgeLayer(edge.relationshipType)]) return [];
    const data: FlowEdgeData = {
      relationshipType: edge.relationshipType,
      validationStatus: edge.validationStatus,
      ...(edge.description ? { description: edge.description } : {}),
      ...(edge.protocol ? { protocol: edge.protocol } : {}),
      ...(edge.port ? { port: edge.port } : {}),
    };
    return [{
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'semantic',
      ...(edge.label ? { label: edge.label } : {}),
      selected: selected.has(edge.id),
      data,
      ...(edge.sourceHandle ? { sourceHandle: edge.sourceHandle } : {}),
      ...(edge.targetHandle ? { targetHandle: edge.targetHandle } : {}),
      ...(edge.direction === 'forward' || edge.direction === 'bidirectional' ? { markerEnd: { type: 'arrowclosed' as const, width: 18, height: 18 } } : {}),
      animated: edge.relationshipType === 'network-traffic',
    }];
  });
}

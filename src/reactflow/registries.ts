/**
 * @file React Flow renderer and canvas option registries.
 * @module reactflow/registries
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file registers node and edge components plus shared snap, fit-view, and edge interaction settings.
 */
import type { EdgeTypes, NodeTypes } from '@xyflow/react';
import { BoundaryNode } from '../ui/nodes/BoundaryNode';
import { AwsResourceNode } from '../ui/nodes/AwsResourceNode';
import { ControlNode } from '../ui/nodes/ControlNode';
import { ExternalNode } from '../ui/nodes/ExternalNode';
import { TextNode } from '../ui/nodes/TextNode';
import { LegendNode } from '../ui/nodes/LegendNode';
import { SemanticEdge } from '../ui/edges/SemanticEdge';

/** React Flow node renderer registry for architecture node kinds. */
export const NODE_TYPES: NodeTypes = { boundary: BoundaryNode, resource: AwsResourceNode, control: ControlNode, external: ExternalNode, text: TextNode, legend: LegendNode };
/** React Flow edge renderer registry for semantic edges. */
export const EDGE_TYPES: EdgeTypes = { semantic: SemanticEdge };
/** Canvas snap grid size in diagram units. */
/** Default viewport fitting options for React Flow. */
export const FIT_VIEW_OPTIONS = { padding: 0.08, minZoom: 0.2, maxZoom: 1.2 } as const;
/** Default interaction settings for newly rendered semantic edges. */
export const DEFAULT_EDGE_OPTIONS = { type: 'semantic', interactionWidth: 24 } as const;

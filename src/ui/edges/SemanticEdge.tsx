/**
 * @file Semantic relationship edge renderer.
 * @module ui/edges/SemanticEdge
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file renders styled React Flow edges and optional labels for architecture relationships.
 */
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { ArchitectureFlowEdge } from '../../reactflow/adapters';

/** Renders a labeled semantic edge between architecture nodes. */
export function SemanticEdge(props: EdgeProps<ArchitectureFlowEdge>) {
  const [path, labelX, labelY] = getSmoothStepPath(props);
  const relationship = props.data?.relationshipType ?? 'relationship';
  return (
    <>
      <BaseEdge path={path} {...(props.markerEnd ? { markerEnd: props.markerEnd } : {})} className={`semantic-edge relationship-${relationship} ${props.selected ? 'is-selected' : ''}`} />
      {props.label && <EdgeLabelRenderer><span className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{String(props.label)}</span></EdgeLabelRenderer>}
    </>
  );
}

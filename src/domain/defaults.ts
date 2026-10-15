/**
 * @file Default diagram document construction.
 * @module domain/defaults
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file defines visible layers and creates empty version-six architecture documents with default preferences.
 */
import type { DiagramDocument, LayerId } from './types';
import { uniqueId } from './ids';

/** Ordered list of every toggleable visual layer. */
export const ALL_LAYERS: readonly LayerId[] = [
  'administrative-boundaries',
  'network-boundaries',
  'aws-resources',
  'stack-overlays',
  'stackset-overlays',
  'stack-instance-overlays',
  'logical-overlays',
  'iam-governance',
  'security-groups',
  'network-traffic',
  'deployment-dependencies',
  'data-flow',
  'external-references',
  'import-diagnostics',
  'labels-metadata',
  'review-comments',
];

/** Creates a new empty diagram document with default preferences. */
export function createEmptyDocument(title = 'Untitled architecture'): DiagramDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 6,
    id: uniqueId('document'),
    metadata: { title, description: '', createdAt: now, updatedAt: now },
    nodesById: {},
    nodeOrder: [],
    edgesById: {},
    edgeOrder: [],
    commentsById: {},
    commentOrder: [],
    deploymentGroupsById: {},
    deploymentGroupOrder: [],
    logicalGroupsById: {},
    logicalGroupOrder: [],
    stackInstancesById: {},
    stackInstanceOrder: [],
    templatesById: {},
    templateOrder: [],
    importSourcesById: {},
    importSourceOrder: [],
    savedFiltersById: {},
    savedFilterOrder: [],
    viewport: { x: 0, y: 0, zoom: 0.8 },
    preferences: {
      snapToGrid: true,
      gridSize: 16,
      keyboardMoveIncrement: 8,
      autosave: true,
      reducedMotion: false,
      layoutDirection: 'RIGHT',
      layoutDensity: 'balanced',
    },
    visibleLayers: Object.fromEntries(ALL_LAYERS.map((layer) => [layer, true])) as Record<LayerId, boolean>,
    currentViewMode: 'infrastructure',
    layoutPreferences: { algorithm: 'layered', onlyUnpositioned: false, epsilon: 0.5 },
    revision: { number: 0, lastCommand: 'create-document', updatedAt: now },
  };
}

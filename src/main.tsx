/**
 * @file Browser application entry point.
 * @module main
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file exposes development diagnostics, finds the root DOM node, and mounts the React application.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles.css';
import { useDiagramStore } from './store/useDiagramStore';

if (import.meta.env.DEV) {
  window.__ARCHITECTURE_STUDIO__ = {
    getSnapshot: () => {
      const state = useDiagramStore.getState();
      return {
        revision: state.document.revision.number,
        undoCount: state.undoStack.length,
        selectedNodeIds: state.selection.nodeIds,
        nodes: Object.fromEntries(Object.values(state.document.nodesById).map((node) => [node.id, { x: node.position.x, y: node.position.y, ...(node.physicalParentId ? { parentId: node.physicalParentId } : {}) }])),
        viewMode: state.document.currentViewMode,
      };
    },
  };
}

/** DOM element that hosts the React application. */
const root = document.getElementById('root');
if (!root) throw new Error('Application root element was not found.');
createRoot(root).render(<StrictMode><App /></StrictMode>);

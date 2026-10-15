/**
 * @file Root application component and provider setup.
 * @module app/App
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file wires the autosave repository into the React Flow provider and renders the editor shell.
 */
import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Editor } from './Editor';
import { LocalStorageDiagramRepository } from '../persistence/repository';
import { startAutosave } from '../persistence/autosave';

/** Repository instance used by application-wide autosave. */
const repository = new LocalStorageDiagramRepository();

/** Mounts global providers and the editor shell. */
export function App() {
  useEffect(() => startAutosave(repository), []);
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}

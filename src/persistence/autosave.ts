/**
 * @file Debounced diagram autosave subscription.
 * @module persistence/autosave
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file watches document revisions and persists changes through the configured repository after a delay.
 */
import type { DiagramStore } from '../store/useDiagramStore';
import { useDiagramStore } from '../store/useDiagramStore';
import type { DiagramRepository } from './repository';

/** Subscribes to document revisions and saves changes after a debounce. */
export function startAutosave(repository: DiagramRepository, delayMs = 700): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useDiagramStore.subscribe((state, previous) => {
    if (!state.document.preferences.autosave || state.document.revision.number === previous.document.revision.number) return;
    if (timer) clearTimeout(timer);
    useDiagramStore.getState().setAutosave({ status: 'saving', savedRevision: previous.autosave.savedRevision });
    timer = setTimeout(() => {
      const current = useDiagramStore.getState();
      void repository.save(current.document).then(
        () => useDiagramStore.getState().setAutosave({ status: 'saved', savedRevision: current.document.revision.number }),
        (error: unknown) => useDiagramStore.getState().setAutosave({ status: 'error', savedRevision: current.autosave.savedRevision, message: error instanceof Error ? error.message : String(error) }),
      );
    }, delayMs);
  });
  return () => { if (timer) clearTimeout(timer); unsubscribe(); };
}

/** Selects the current document revision number for persistence tests. */
export function selectPersistedRevision(state: DiagramStore): number { return state.document.revision.number; }

/**
 * @file Automatic diagram layout service.
 * @module layout/service
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file chooses a worker or main-thread ELK executor and suppresses stale layout responses.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramDocument, LayoutRequest, LayoutResult } from '../domain/types';
import { applyElkGraph, buildElkGraph } from './elkGraph';

/** Abstraction for running ELK layout in a worker or on the main thread. */
export interface ElkExecutor {
  layout(graph: ElkNode, requestId: string): Promise<ElkNode>;
  dispose(): void;
}

/** ELK executor used when workers are unavailable or disabled for tests. */
export class MainThreadElkExecutor implements ElkExecutor {
  private readonly elk = new ELK();
  async layout(graph: ElkNode): Promise<ElkNode> { return this.elk.layout(graph); }
  dispose(): void { /* no resources */ }
}

/** ELK executor that delegates layout work to a browser worker. */
export class WorkerElkExecutor implements ElkExecutor {
  private readonly worker: Worker;
  private pending = new Map<string, { resolve: (value: ElkNode) => void; reject: (error: Error) => void }>();
  constructor() {
    this.worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<{ requestId: string; result?: ElkNode; error?: string }>) => {
      const pending = this.pending.get(event.data.requestId);
      if (!pending) return;
      this.pending.delete(event.data.requestId);
      if (event.data.error) pending.reject(new Error(event.data.error));
      else if (event.data.result) pending.resolve(event.data.result);
      else pending.reject(new Error('ELK worker returned no result.'));
    };
    this.worker.onerror = (event) => {
      for (const pending of this.pending.values()) pending.reject(new Error(event.message));
      this.pending.clear();
    };
  }
  layout(graph: ElkNode, requestId: string): Promise<ElkNode> {
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ requestId, graph });
    });
  }
  dispose(): void {
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new Error('ELK worker disposed.'));
    this.pending.clear();
  }
}

/** Selects the best available ELK executor for the current runtime. */
function defaultExecutor(): ElkExecutor {
  const testFallback = typeof window !== 'undefined' && window.__ARCHITECTURE_STUDIO_TEST_MAIN_THREAD_LAYOUT__ === true;
  return typeof Worker === 'undefined' || testFallback ? new MainThreadElkExecutor() : new WorkerElkExecutor();
}

/** Coordinates graph construction, ELK execution, and stale-result suppression. */
export class DiagramLayoutService {
  private latestRequestId = '';
  private readonly executor: ElkExecutor;
  constructor(executor?: ElkExecutor) { this.executor = executor ?? defaultExecutor(); }

  async layout(document: DiagramDocument, request: LayoutRequest): Promise<LayoutResult | undefined> {
    this.latestRequestId = request.id;
    const graph = buildElkGraph(document, request);
    const resultGraph = await this.executor.layout(graph, request.id);
    if (request.id !== this.latestRequestId) return undefined;
    return applyElkGraph(document, request, resultGraph);
  }
  cancelPending(): void { this.latestRequestId = ''; }
  dispose(): void { this.executor.dispose(); }
}

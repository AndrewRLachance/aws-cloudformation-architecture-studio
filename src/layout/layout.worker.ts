/// <reference lib="webworker" />
/**
 * @file Background ELK layout worker.
 * @module layout/layout.worker
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file receives layout graph messages, runs ELK in a web worker, and posts layout results back.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

/** Worker-local ELK instance reused for layout messages. */
const elk = new ELK();
self.onmessage = (event: MessageEvent<{ requestId: string; graph: ElkNode }>) => {
  const { requestId, graph } = event.data;
  void elk.layout(graph).then(
    (result) => self.postMessage({ requestId, result }),
    (error: unknown) => self.postMessage({ requestId, error: error instanceof Error ? error.message : String(error) }),
  );
};

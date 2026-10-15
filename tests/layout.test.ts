import type { ElkNode } from 'elkjs/lib/elk-api';
import { describe, expect, it } from 'vitest';
import { buildElkGraph } from '../src/layout/elkGraph';
import { DiagramLayoutService, MainThreadElkExecutor, type ElkExecutor } from '../src/layout/service';
import { createSeedDocument } from '../src/domain/seed';
import type { LayoutRequest } from '../src/domain/types';

function request(id = 'layout-1'): LayoutRequest {
  return { id, direction: 'RIGHT', density: 'balanced', mode: 'physical-hierarchy', scope: 'all', selectedNodeIds: [], onlyUnpositioned: false, createdAt: '2026-06-18T00:00:00.000Z' };
}

describe('ELK layout', () => {
  it('builds deterministic compound graphs with fully-qualified options and parent hierarchy', () => {
    const document = createSeedDocument();
    const first = buildElkGraph(document, request());
    const second = buildElkGraph(document, request());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.layoutOptions?.['elk.algorithm']).toBe('layered');
    expect(first.layoutOptions?.['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');
    const org = first.children?.find((node) => node.id === 'org-acme');
    expect(org?.children?.some((node) => node.id === 'ou-production')).toBe(true);
  });

  it('uses the real ELK package and returns parent-relative positions and boundary sizes', async () => {
    const document = createSeedDocument();
    const service = new DiagramLayoutService(new MainThreadElkExecutor());
    const result = await service.layout(document, request());
    expect(result?.requestId).toBe('layout-1');
    expect(Object.keys(result?.positions ?? {}).length).toBeGreaterThan(10);
    expect(result?.positions['subnet-app-a']).toBeDefined();
    expect(result?.sizes['vpc-prod']?.width).toBeGreaterThanOrEqual(document.nodesById['vpc-prod']!.size.width);
    expect(result?.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0);
    service.dispose();
  }, 20_000);

  it('excludes locked and pinned nodes from graph movement', async () => {
    const base = createSeedDocument();
    const locked = { ...base.nodesById['ecs-service-a']!, locked: true };
    const document = { ...base, nodesById: { ...base.nodesById, [locked.id]: locked } };
    const graph = buildElkGraph(document, request());
    expect(JSON.stringify(graph)).not.toContain('ecs-service-a');
  });

  it('suppresses stale results when request B starts after request A', async () => {
    let releaseA: ((value: ElkNode) => void) | undefined;
    const executor: ElkExecutor = {
      layout: (graph, id) => id === 'A' ? new Promise((resolve) => { releaseA = resolve; }) : Promise.resolve(graph),
      dispose: () => undefined,
    };
    const service = new DiagramLayoutService(executor);
    const document = createSeedDocument();
    const pendingA = service.layout(document, request('A'));
    const resultB = await service.layout(document, request('B'));
    releaseA?.(buildElkGraph(document, request('A')));
    const resultA = await pendingA;
    expect(resultB?.requestId).toBe('B');
    expect(resultA).toBeUndefined();
  });

  it('propagates worker/executor failures without committing a layout', async () => {
    const executor: ElkExecutor = { layout: async () => { throw new Error('worker failed'); }, dispose: () => undefined };
    const service = new DiagramLayoutService(executor);
    await expect(service.layout(createSeedDocument(), request())).rejects.toThrow('worker failed');
  });
});

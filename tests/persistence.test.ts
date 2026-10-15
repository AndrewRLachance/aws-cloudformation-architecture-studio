import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSeedDocument } from '../src/domain/seed';
import { createEmptyDocument } from '../src/domain/defaults';
import { DocumentValidationError, parseDiagramDocument } from '../src/domain/schema';
import { deserializeDocument, LocalStorageDiagramRepository, serializeDocument } from '../src/persistence/repository';
import { startAutosave } from '../src/persistence/autosave';
import { useDiagramStore } from '../src/store/useDiagramStore';

describe('versioned persistence', () => {
  it('serializes deterministically and restores viewport, templates and provenance', () => {
    const document = createSeedDocument();
    const first = serializeDocument(document);
    const second = serializeDocument(document);
    expect(first).toBe(second);
    const restored = deserializeDocument(first);
    expect(restored.viewport).toEqual(document.viewport);
    expect(restored.stackInstanceOrder).toEqual(document.stackInstanceOrder);
  });

  it('migrates schema v1 documents', () => {
    const migrated = parseDiagramDocument({ schemaVersion: 1, id: 'legacy', title: 'Legacy', nodes: [], edges: [] });
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.id).toBe('legacy');
    expect(migrated.metadata.title).toBe('Legacy');
  });

  it('migrates schema v4 templates and stacks to deterministic v6 fidelity metadata', async () => {
    const { createCloudFormationImportPlan } = await import('../src/cloudformation/importer');
    const plan = await createCloudFormationImportPlan([{ name: 'raw-template.yaml', data: readFileSync(join(process.cwd(), 'fixtures', 'raw-template.yaml'), 'utf8') }], { importType: 'single-stack' });
    const base = createEmptyDocument();
    const current = { ...base, nodesById: Object.fromEntries(plan.nodes.map((node) => [node.id, node])), nodeOrder: plan.nodes.map((node) => node.id), deploymentGroupsById: Object.fromEntries(plan.deploymentGroups.map((group) => [group.id, group])), deploymentGroupOrder: plan.deploymentGroups.map((group) => group.id), templatesById: Object.fromEntries(plan.templates.map((template) => [template.id, template])), templateOrder: plan.templates.map((template) => template.id) };
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    legacy.schemaVersion = 4;
    Object.values(legacy.templatesById as Record<string, Record<string, unknown>>).forEach((template) => { delete template.fidelity; });
    Object.values(legacy.deploymentGroupsById as Record<string, Record<string, unknown>>).forEach((group) => { if (group.kind === 'stack') delete group.deploymentMetadata; });
    const first = parseDiagramDocument(legacy);
    const second = parseDiagramDocument(legacy);
    expect(first.schemaVersion).toBe(6);
    expect(first.templatesById[first.templateOrder[0] ?? '']?.fidelity.dialects).toContain('language-extensions');
    expect(Object.values(first.deploymentGroupsById).find((group) => group.kind === 'stack' && group.deploymentMetadata.length === 0)).toBeDefined();
    expect(serializeDocument(first)).toBe(serializeDocument(second));
  });

  it('migrates schema v3 StackSets, nested groups, source maps and imported boundaries to v4', async () => {
    const parsed = await import('../src/cloudformation/importer').then(({ createCloudFormationImportPlan }) => createCloudFormationImportPlan([{ name: 'network.yaml', data: readFileSync(join(process.cwd(), 'fixtures', 'network.yaml'), 'utf8') }], { importType: 'stackset' }));
    const base = createEmptyDocument();
    const v4 = { ...base, nodesById: Object.fromEntries(parsed.nodes.map((node) => [node.id, node])), nodeOrder: parsed.nodes.map((node) => node.id), deploymentGroupsById: Object.fromEntries(parsed.deploymentGroups.map((group) => [group.id, group])), deploymentGroupOrder: parsed.deploymentGroups.map((group) => group.id), templatesById: Object.fromEntries(parsed.templates.map((template) => [template.id, template])), templateOrder: parsed.templates.map((template) => template.id) };
    const legacy = JSON.parse(JSON.stringify(v4)) as Record<string, unknown>;
    legacy.schemaVersion = 3;
    const groups = legacy.deploymentGroupsById as Record<string, Record<string, unknown>>;
    Object.values(groups).forEach((group) => { delete group.targetGroups; delete group.operationPreferences; });
    const templates = legacy.templatesById as Record<string, Record<string, unknown>>;
    Object.values(templates).forEach((template) => { delete template.sourceLocations; });
    const nodes = legacy.nodesById as Record<string, Record<string, unknown>>;
    Object.values(nodes).forEach((node) => { if (node.kind === 'boundary') delete node.cloudFormation; });
    const migrated = parseDiagramDocument(legacy);
    expect(migrated.schemaVersion).toBe(6);
    expect(Object.values(migrated.deploymentGroupsById).find((group) => group.kind === 'stackset' && group.targetGroups.length === 0)).toBeDefined();
    expect(Object.values(migrated.templatesById)[0]?.sourceLocations).toEqual({});
    expect(Object.values(migrated.nodesById).some((node) => node.kind === 'boundary' && node.sourceLogicalId && node.cloudFormation)).toBe(true);
  });

  it('migrates a version-3 nested deployment to an exact parent resource association', async () => {
    const { createCloudFormationImportPlan } = await import('../src/cloudformation/importer');
    const plan = await createCloudFormationImportPlan([{ name: 'nested-parent.yaml', data: readFileSync(join(process.cwd(), 'fixtures', 'nested-parent.yaml'), 'utf8') }], { importType: 'single-stack', defaultAccountId: '111111111111', defaultRegion: 'us-east-1' });
    const base = createEmptyDocument();
    const current = { ...base, nodesById: Object.fromEntries(plan.nodes.map((node) => [node.id, node])), nodeOrder: plan.nodes.map((node) => node.id), edgesById: Object.fromEntries(plan.edges.map((edge) => [edge.id, edge])), edgeOrder: plan.edges.map((edge) => edge.id), deploymentGroupsById: Object.fromEntries(plan.deploymentGroups.map((group) => [group.id, group])), deploymentGroupOrder: plan.deploymentGroups.map((group) => group.id), templatesById: Object.fromEntries(plan.templates.map((template) => [template.id, template])), templateOrder: plan.templates.map((template) => template.id) };
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>; legacy.schemaVersion = 3;
    const nested = Object.values(legacy.deploymentGroupsById as Record<string, Record<string, unknown>>).find((group) => group.kind === 'nested-stack');
    expect(nested).toBeDefined();
    delete nested?.parentResourceNodeId; delete nested?.associationConfirmed;
    const migrated = parseDiagramDocument(legacy);
    const migratedNested = Object.values(migrated.deploymentGroupsById).find((group) => group.kind === 'nested-stack');
    expect(migratedNested?.kind === 'nested-stack' && migratedNested.parentResourceNodeId).toBe(migratedNested?.nodeIds[0]);
    expect(migratedNested?.kind === 'nested-stack' && migratedNested.associationConfirmed).toBe(false);
  });

  it('rejects malformed, broken-reference and forward-version documents with useful messages', () => {
    expect(() => deserializeDocument('{broken')).toThrow('malformed');
    expect(() => parseDiagramDocument({ schemaVersion: 99 })).toThrow(/newer/);
    const broken = { ...createEmptyDocument(), nodeOrder: ['missing'] };
    expect(() => parseDiagramDocument(broken)).toThrow(DocumentValidationError);
  });

  it('migrates v5 documents with deterministic diagram-editing defaults', () => {
    const current = createSeedDocument();
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    legacy.schemaVersion = 5;
    delete (legacy.preferences as Record<string, unknown>).keyboardMoveIncrement;
    delete legacy.commentsById; delete legacy.commentOrder; delete legacy.savedFiltersById; delete legacy.savedFilterOrder;
    Object.values(legacy.nodesById as Record<string, Record<string, unknown>>).forEach((node) => { delete node.diagramTags; delete node.annotations; });
    const migrated = parseDiagramDocument(legacy);
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.preferences.keyboardMoveIncrement).toBe(8);
    expect(migrated.commentsById).toEqual({});
    expect(migrated.savedFiltersById).toEqual({});
    expect(Object.values(migrated.nodesById).every((node) => node.annotations.length === 0 && Object.keys(node.diagramTags).length === 0)).toBe(true);
  });

  it('saves and loads through the local-storage repository', async () => {
    const repository = new LocalStorageDiagramRepository('test-diagram');
    await repository.save(createSeedDocument());
    expect((await repository.load())?.metadata.title).toBe('Production multi-account architecture');
    await repository.clear();
    expect(await repository.load()).toBeUndefined();
  });

  it('debounces autosave by meaningful document revision rather than transient selection', async () => {
    vi.useFakeTimers();
    useDiagramStore.setState({ document: createSeedDocument(), autosave: { status: 'idle', savedRevision: 0 }, undoStack: [], redoStack: [] });
    const repository = { save: vi.fn(async () => undefined), load: vi.fn(async () => undefined), clear: vi.fn(async () => undefined) };
    const stop = startAutosave(repository, 100);
    useDiagramStore.getState().select(['ecs-service-a']);
    await vi.advanceTimersByTimeAsync(150);
    expect(repository.save).not.toHaveBeenCalled();
    useDiagramStore.getState().setViewMode('deployment');
    useDiagramStore.getState().setViewMode('security');
    await vi.advanceTimersByTimeAsync(99);
    expect(repository.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.save).toHaveBeenCalledTimes(1);
    stop(); vi.useRealTimers();
  });
});

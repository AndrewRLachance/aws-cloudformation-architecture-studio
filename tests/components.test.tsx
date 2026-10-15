import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { Editor } from '../src/app/Editor';
import { ImportCloudFormationDialog } from '../src/ui/dialogs/ImportCloudFormationDialog';
import { Inspector } from '../src/ui/inspector/Inspector';
import { SourceCodeViewer } from '../src/ui/components/SourceCodeViewer';
import { RelationshipEditorDialog } from '../src/ui/dialogs/RelationshipEditorDialog';
import { ExportDiagramDialog } from '../src/ui/dialogs/ExportDiagramDialog';
import { createSeedDocument } from '../src/domain/seed';
import { useDiagramStore } from '../src/store/useDiagramStore';

beforeEach(() => {
  useDiagramStore.setState({ document: createSeedDocument(), selection: { nodeIds: [], edgeIds: [] }, undoStack: [], redoStack: [], importPreview: undefined, inspectorTab: 'properties', sourceNavigation: undefined, operationProgress: undefined, announcement: '' });
});

describe('accessible React UI', () => {
  it('renders the CSS Grid editor shell, semantic controls and source-of-truth canvas', () => {
    render(<ReactFlowProvider><Editor /></ReactFlowProvider>);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: /AWS architecture diagram canvas/i })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: /resize inspector/i })).toHaveAttribute('aria-valuemin', '240');
    expect(screen.getByRole('complementary', { name: /Architecture palette/i })).toBeInTheDocument();
  });

  it('resizes the inspector using Arrow, Home and End keys', () => {
    render(<ReactFlowProvider><Editor /></ReactFlowProvider>);
    const separator = screen.getByRole('separator', { name: /resize inspector/i });
    expect(separator).toHaveAttribute('aria-valuenow', '330');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '346');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '240');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '700');
  });

  it('opens a seven-step accessible CloudFormation import dialog and supports Escape', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<ImportCloudFormationDialog open onClose={close} />);
    const dialog = screen.getByRole('dialog', { name: /Import CloudFormation/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(7);
    expect(within(dialog).getByRole('radio', { name: /Raw single-stack template/i })).toBeChecked();
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses controlled, idempotent selection and derives the Template tab directly', async () => {
    const user = userEvent.setup();
    useDiagramStore.getState().select(['ecs-service-a']);
    render(<Inspector collapsed={false} onToggle={() => undefined} />);
    expect(screen.getByRole('heading', { name: /ECS Service/ })).toBeInTheDocument();
    const before = useDiagramStore.getState();
    before.select(['ecs-service-a']);
    expect(useDiagramStore.getState()).toBe(before);
    await user.click(screen.getByRole('tab', { name: 'Template' }));
    expect(screen.getByLabelText('Template view')).toBeInTheDocument();
    expect(screen.getByText(/Source path:/)).toBeInTheDocument();
  });

  it('renders syntax-highlighted numbered source and navigates search matches', async () => {
    const user = userEvent.setup();
    render(<SourceCodeViewer text={'Resources:\n  Bucket:\n    Type: AWS::S3::Bucket\n  OtherBucket:\n    Type: AWS::S3::Bucket\n'} language="yaml" activeLine={2} />);
    expect(screen.getByText('5 lines')).toBeInTheDocument();
    expect(document.querySelector('[data-line="2"]')).toHaveClass('is-active');
    await user.type(screen.getByRole('searchbox', { name: /Search source/i }), 'Bucket');
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Next source match/i }));
    expect(screen.getByText('2 of 4')).toBeInTheDocument();
  });

  it('creates a typed manual relationship through the connection workflow dialog', async () => {
    const user = userEvent.setup();
    const before = useDiagramStore.getState().document.edgeOrder.length;
    render(<RelationshipEditorDialog open sourceId="s3-assets" targetId="ddb-sessions" sourceHandle="out" targetHandle="in" onClose={() => undefined} />);
    await user.selectOptions(screen.getByLabelText('Relationship type'), 'replicates-to');
    await user.type(screen.getByLabelText('Description'), 'Cross-store replication');
    await user.click(screen.getByRole('button', { name: /Save relationship/i }));
    const state = useDiagramStore.getState();
    expect(state.document.edgeOrder).toHaveLength(before + 1);
    expect(Object.values(state.document.edgesById).some((edge) => edge.relationshipType === 'replicates-to' && edge.description === 'Cross-store replication')).toBe(true);
  });

  it('keeps raw property edits transactional and blocks invalid JSON', async () => {
    const user = userEvent.setup();
    useDiagramStore.getState().select(['s3-assets']);
    render(<Inspector collapsed={false} onToggle={() => undefined} />);
    const apply = screen.getByRole('button', { name: /Apply properties/i });
    await waitFor(() => expect(apply).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Raw JSON' }));
    const editor = screen.getByLabelText('Properties JSON');
    fireEvent.change(editor, { target: { value: '{' } });
    expect(apply).toBeDisabled();
    expect((useDiagramStore.getState().document.nodesById['s3-assets'] as { properties: Record<string, unknown> }).properties).toEqual({});
    fireEvent.change(editor, { target: { value: '{"BucketName":"local-assets"}' } });
    await waitFor(() => expect(apply).toBeEnabled());
    await user.click(apply);
    expect((useDiagramStore.getState().document.nodesById['s3-assets'] as { properties: Record<string, unknown> }).properties.BucketName).toBe('local-assets');
  });

  it('shows a mixed-value bulk inspector and applies diagram tags transactionally', async () => {
    const user = userEvent.setup();
    useDiagramStore.getState().select(['s3-assets', 'ddb-sessions']);
    render(<Inspector collapsed={false} onToggle={() => undefined} />);
    expect(screen.getByRole('heading', { name: '2 nodes selected' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Key'), 'Owner'); await user.type(screen.getByLabelText('Value'), 'Platform');
    await user.click(screen.getByRole('button', { name: 'Set diagram tag' }));
    expect(useDiagramStore.getState().document.nodesById['s3-assets']?.diagramTags.Owner).toBe('Platform');
    expect(useDiagramStore.getState().document.nodesById['ddb-sessions']?.diagramTags.Owner).toBe('Platform');
  });

  it('exposes built-in starters, AWS patterns, and document filters', () => {
    render(<ReactFlowProvider><Editor /></ReactFlowProvider>);
    expect(screen.getByRole('heading', { name: 'Architecture starters' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AWS patterns' })).toBeInTheDocument();
    expect(screen.getByLabelText('Active saved filter')).toBeInTheDocument();
  });

  it('traps focus in export dialogs and announces shared operation progress', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(<ReactFlowProvider><ExportDiagramDialog open onClose={close} /></ReactFlowProvider>);
    const exportDialog = screen.getByRole('dialog', { name: /Export diagram/i });
    expect(screen.getByRole('button', { name: /Close export dialog/i })).toHaveFocus();
    await user.tab({ shift: true });
    expect(exportDialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(close).toHaveBeenCalledTimes(1);

    useDiagramStore.getState().setOperationProgress({ id: 'operation-test', kind: 'import', status: 'running', phase: 'parse', completed: 2, total: 4, percent: 50, message: 'Parsing templates.' });
    render(<ImportCloudFormationDialog open onClose={() => undefined} />);
    expect(screen.getByRole('progressbar', { name: /Import operation progress/i })).toHaveValue(2);
    expect(screen.getByText('Parsing templates.')).toBeInTheDocument();
  });
});

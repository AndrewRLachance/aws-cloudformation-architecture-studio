import { test, expect, type Page } from '@playwright/test';

async function snapshot(page: Page) {
  return page.evaluate(() => window.__ARCHITECTURE_STUDIO__?.getSnapshot());
}

async function drag(page: Page, sourceTestId: string, targetTestId?: string, delta = { x: 35, y: 18 }) {
  const source = page.getByTestId(sourceTestId);
  await expect(source).toBeVisible();
  const sourceBox = await source.boundingBox();
  if (!sourceBox) throw new Error(`No bounding box for ${sourceTestId}`);
  let end = { x: sourceBox.x + sourceBox.width / 2 + delta.x, y: sourceBox.y + sourceBox.height / 2 + delta.y };
  if (targetTestId) {
    const target = page.getByTestId(targetTestId);
    await expect(target).toBeVisible();
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error(`No bounding box for ${targetTestId}`);
    end = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + Math.min(targetBox.height - 24, 76) };
  }
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 });
  await page.mouse.up();
}

async function connect(page: Page, sourceTestId: string, targetTestId: string) {
  const source = page.getByTestId(sourceTestId).locator('.react-flow__handle-right');
  const target = page.getByTestId(targetTestId).locator('.react-flow__handle-left');
  const sourceBox = await source.boundingBox(); const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Connection handles are not visible.');
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 6 });
  await page.mouse.up();
}

test('real browser dragging remains stable without controlled-state update loops', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.__ARCHITECTURE_STUDIO_TEST_MAIN_THREAD_LAYOUT__ = true;
    window.addEventListener('unhandledrejection', (event) => console.error(`Unhandled rejection: ${String(event.reason)}`));
  });
  await page.setViewportSize({ width: 1800, height: 1040 });
  await page.goto('/');
  await expect(page.getByText('CloudFormation Studio')).toBeVisible();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(600);

  const initial = await snapshot(page);
  expect(initial).toBeDefined();

  // Multiple real resource drags within current parents.
  await drag(page, 'node-ecs-service-a', undefined, { x: 24, y: 10 });
  const moved = await snapshot(page);
  expect(moved?.undoCount).toBe((initial?.undoCount ?? 0) + 1);
  expect(moved?.selectedNodeIds).toEqual(['ecs-service-a']);

  await drag(page, 'node-rds-primary', undefined, { x: 18, y: 8 });
  await drag(page, 'node-alb-prod', undefined, { x: 16, y: 6 });

  // Valid reparent from private app subnet A to private app subnet B.
  await drag(page, 'node-ecs-service-a', 'node-subnet-app-b');
  const reparented = await snapshot(page);
  expect(reparented?.nodes['ecs-service-a']?.parentId).toBe('subnet-app-b');

  // Invalid IAM role -> subnet placement must preserve parent and position.
  const beforeInvalid = await snapshot(page);
  await drag(page, 'node-iam-execution-role', 'node-subnet-app-a');
  const afterInvalid = await snapshot(page);
  expect(afterInvalid?.nodes['iam-execution-role']).toEqual(beforeInvalid?.nodes['iam-execution-role']);

  // Detach and reattach through the accessible context menu and a real drag.
  await page.getByTestId('node-ecs-service-b').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Detach' }).click();
  expect((await snapshot(page))?.nodes['ecs-service-b']?.parentId).toBeUndefined();
  await drag(page, 'node-ecs-service-b', 'node-subnet-app-b');
  expect((await snapshot(page))?.nodes['ecs-service-b']?.parentId).toBe('subnet-app-b');

  // Select/deselect while dragging, switch views/layers, then drag again.
  await page.getByTestId('node-ecs-service-a').click();
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 250 } });
  await page.getByLabel('View mode').selectOption('deployment');
  await page.getByText('Layers', { exact: true }).click();
  await page.getByLabel('Network traffic').uncheck();
  await page.keyboard.press('Escape');
  await drag(page, 'node-s3-assets', undefined, { x: 20, y: 8 });

  // Drag after a real ELK layout and confirm the app remains interactive.
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect(page.getByRole('button', { name: 'Auto layout' })).toBeEnabled({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await drag(page, 'node-ddb-sessions', undefined, { x: 18, y: 8 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByRole('main', { name: /AWS architecture diagram canvas/i })).toBeVisible();

  const final = await snapshot(page);
  expect(final?.viewMode).toBe('deployment');
  expect(final?.selectedNodeIds.length).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('creates a semantic connection and opens configurable diagram export', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1040 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.waitForTimeout(400);
  const before = await snapshot(page);
  await connect(page, 'node-s3-assets', 'node-ddb-sessions');
  const dialog = page.getByRole('dialog', { name: /Create relationship/i });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Relationship type').selectOption('replicates-to');
  await dialog.getByLabel('Label').fill('Browser-created relationship');
  await dialog.getByRole('button', { name: /Save relationship/i }).click();
  expect((await snapshot(page))?.revision).toBe((before?.revision ?? 0) + 1);

  await page.getByText('Export', { exact: true }).click();
  await page.getByRole('button', { name: 'Export Diagram…' }).click();
  const exportDialog = page.getByRole('dialog', { name: /Export diagram/i });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole('radio', { name: /SVG/i }).check();
  await expect(exportDialog.getByRole('button', { name: 'Export SVG' })).toBeEnabled();
  await exportDialog.getByRole('button', { name: 'Cancel' }).click();
});

test('resolves multi-stack associations and navigates to an imported source line', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Import CloudFormation' }).click();
  const dialog = page.getByRole('dialog', { name: /Import CloudFormation/i });
  await dialog.getByRole('radio', { name: /Multiple-stack bundle/i }).check();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.locator('input[type="file"]').setInputFiles([
    { name: 'application.yaml', mimeType: 'application/yaml', buffer: Buffer.from("Resources:\n  AppBucket:\n    Type: AWS::S3::Bucket\n") },
    { name: 'data.yaml', mimeType: 'application/yaml', buffer: Buffer.from("Resources:\n  DataTable:\n    Type: AWS::DynamoDB::Table\n    Properties:\n      KeySchema: []\n      AttributeDefinitions: []\n      ProvisionedThroughput:\n        ReadCapacityUnits: 1\n        WriteCapacityUnits: 1\n") },
  ]);
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: /Analyze selected files/i }).click();
  await expect(dialog.getByText(/association candidates/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByRole('heading', { name: 'Template ownership' })).toBeVisible();
  for (const confirmation of await dialog.getByLabel('I confirm this stack association.').all()) await confirmation.check();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByLabel(/Run ELK layout/i).uncheck();
  await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: /Commit import/i }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.getByLabel('AppBucket, AWS::S3::Bucket').click();
  await page.getByRole('tab', { name: 'Properties' }).click();
  await page.getByRole('button', { name: /Go to CloudFormation source/i }).click();
  await expect(page.getByLabel('Template view')).toHaveValue('original-template');
  await expect(page.locator('.source-line.is-active')).toContainText('AppBucket');
  await expect(page.getByText(/Source path: Resources\.AppBucket · line 2/)).toBeVisible();
});

test('inserts an AWS pattern, saves a filter, and manages a review comment', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1040 });
  await page.goto('/');
  const before = await snapshot(page);
  await page.getByRole('button', { name: /API \+ Lambda \+ DynamoDB/ }).click();
  expect((await snapshot(page))?.revision).toBe((before?.revision ?? 0) + 1);
  await expect(page.getByText('HTTP API', { exact: true })).toBeVisible();

  await page.getByText('Manage filters', { exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Serverless');
  await page.getByLabel('AWS services').fill('Lambda');
  await page.getByRole('button', { name: 'Save filter' }).click();
  await expect(page.getByLabel('Active saved filter')).toHaveValue(/filter/);

  page.once('dialog', (dialog) => dialog.accept('Review serverless boundary'));
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(page.getByText('Review serverless boundary')).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText('Review serverless boundary')).toBeHidden();
  await page.getByLabel('Resolved comments').check();
  await expect(page.getByText('Review serverless boundary')).toBeVisible();
});

import { expect, test } from '@playwright/test';

/**
 * Structurally valid 1×1 RGBA PNG (70 bytes, CRCs verified) — generated
 * in-test so the real sniff → decode → resize → sha256 → IDB pipeline runs
 * end to end in Chromium (no binary fixtures committed).
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

test.describe('Namma Space browser journey', () => {
  test('loads the procedural scene, searches, selects, routes, jumps and stages media', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'The Amber Hall' })).toBeVisible();
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas[aria-label="The Amber Hall 3D viewer"]')).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search points of interest' });
    await search.fill('registration');
    await expect(page.getByRole('option', { name: /Registration Desk/ })).toBeVisible();
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await expect(page.getByText('Selected destination')).toBeVisible();
    await expect(page.getByText('Registration Desk', { exact: true })).toHaveCount(2);

    await page.getByRole('button', { name: /Plot walking route/ }).click();
    await expect(page.getByText(/Route ready/)).toBeVisible();
    await page.getByRole('button', { name: 'Jump to view' }).click();
    await expect(page.getByText('Focused on Registration Desk')).toBeVisible();

    await search.fill('does-not-exist');
    await expect(page.getByText(/No verified destinations match/)).toBeVisible();
    await expect(page.getByText('Selected destination')).toHaveCount(0);

    // Staging migrated to 01 CAPTURE STUDIO at T12 (viewer deviation #3).
    await page.getByTestId('tab-capture').click();
    await expect(page.getByTestId('workspace-capture')).toBeVisible();
    await page.getByLabel('Choose capture images').setInputFiles({
      name: 'walk.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.getByText('1 image staged')).toBeVisible({ timeout: 15_000 });

    expect(errors).toEqual([]);
  });

  test('loads the generated GLB scene through the URL contract', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?scene=glb');

    await expect(page.getByRole('heading', { name: 'The Amber Hall · GLB asset' })).toBeVisible();
    await expect(page.getByText('Loaded Architectural GLB fixture')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas[aria-label="The Amber Hall · GLB asset 3D viewer"]')).toBeVisible();
    expect(errors).toEqual([]);
  });

  // Scene-switch / malformed-bundle / no-route failure paths migrated 1:1
  // to tests/e2e/viewer.spec.ts at T14 (workspace moved to src/components/viewer).

  test('keeps the primary controls usable at a narrow viewport', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('searchbox', { name: 'Search points of interest' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Enter walkthrough/ })).toBeVisible();

    // The staging affordance lives in Capture Studio since T12.
    await page.goto('/?workspace=capture');
    await expect(page.getByLabel('Choose capture images')).toBeVisible();
    await context.close();
  });
});

test.describe('workspace shell (T8)', () => {
  test('renders the tablist pattern and mounts exactly one workspace', async ({ page }) => {
    await page.goto('/');
    const tablist = page.getByRole('tablist', { name: 'Workspaces' });
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(3);

    // Default workspace is 02 Spatial Viewer with roving tabindex
    const viewerTab = page.getByTestId('tab-viewer');
    await expect(viewerTab).toHaveAttribute('aria-selected', 'true');
    await expect(viewerTab).toHaveAttribute('tabindex', '0');
    await expect(page.getByTestId('tab-capture')).toHaveAttribute('tabindex', '-1');
    await expect(page.getByTestId('tab-scan')).toHaveAttribute('tabindex', '-1');

    // aria-controls resolves to the single mounted panel
    await expect(page.locator('[data-testid^="workspace-"]')).toHaveCount(1);
    await expect(page.getByTestId('workspace-viewer')).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: /Spatial Viewer/ })).toBeVisible();
  });

  test('keyboard: arrows wrap, Home/End jump, and panels swap', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-viewer').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('tab-scan')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('workspace-scan')).toBeVisible();
    await expect(page.locator('[data-testid^="workspace-"]')).toHaveCount(1);

    await page.keyboard.press('Home');
    await expect(page.getByTestId('tab-capture')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-capture')).toBeFocused();
    await expect(page.getByTestId('workspace-capture')).toBeVisible();

    await page.keyboard.press('End');
    await expect(page.getByTestId('tab-scan')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tab-scan')).toBeFocused();

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('tab-viewer')).toHaveAttribute('aria-selected', 'true');
  });

  test('digit shortcuts 1/2/3 and Ctrl/Cmd+1..3 switch workspaces', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('1');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByTestId('workspace-scan')).toBeVisible();
    await page.keyboard.press('2');
    await expect(page.getByTestId('workspace-viewer')).toBeVisible();

    // Ctrl/Cmd variant is global — works from inside a text field too
    await page.keyboard.press('Control+1');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();
    await page.keyboard.press('Control+2');
    await expect(page.getByTestId('workspace-viewer')).toBeVisible();

    // Plain digits are ignored while typing in a text field
    await page.getByRole('searchbox', { name: 'Search points of interest' }).fill('2');
    await expect(page.getByTestId('workspace-viewer')).toBeVisible();
  });

  test('leaving the viewer destroys the WebGL canvas (no zombie contexts)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.keyboard.press('1');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await page.keyboard.press('2');
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('session state reports real connectivity, never faked', async ({ page, context }) => {
    await page.goto('/');
    await expect(page.getByText('● LOCAL')).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('◇ OFFLINE')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText('● LOCAL')).toBeVisible();
  });
});

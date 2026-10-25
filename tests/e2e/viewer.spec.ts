import { expect, test } from '@playwright/test';

/**
 * T14 · Spatial Viewer workspace — skeleton→ready handoff (real status lines,
 * §5.12), single-context invariant (zero zombie canvases), scene persistence
 * through the URL contract, camera-pose restore across reload, and the
 * failure-path specs migrated 1:1 from app.spec (T8 selector-migration
 * precedent; bodies unchanged).
 */

test.describe('Spatial viewer workspace (T14)', () => {
  test('shows the scene skeleton with real status lines until the viewer is ready', async ({ page }) => {
    // Hold the navigation fetch so the (real, frequently-seen) loading state
    // is observable instead of racing past it on localhost.
    await page.route('**/scenes/fixture/navigation/nav-data.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto('/');

    const skeleton = page.getByTestId('scene-skeleton');
    await expect(skeleton).toBeVisible();
    // Real pipeline message — never invented progress (§5.12).
    await expect(skeleton).toContainText('Validating scene manifest');
    await expect(skeleton).toHaveAttribute('aria-busy', 'true');

    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await expect(skeleton).toHaveCount(0);
    // Single-context invariant: exactly one live canvas for one workspace.
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('persists the selected scene in the URL so a reload restores it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Choose demonstration scene').selectOption('/scenes/glb-fixture/manifest.json');
    await expect(page.getByRole('heading', { name: 'The Amber Hall · GLB asset' })).toBeVisible();
    await expect(page.getByText('Loaded Architectural GLB fixture')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/scene=/);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'The Amber Hall · GLB asset' })).toBeVisible();
    // GLB scene's real terminal status line (the asset load supersedes "Ready to explore").
    await expect(page.getByText('Loaded Architectural GLB fixture')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('restores the last camera viewpoint of a scene after reload', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/X -4\.50 · Z 3\.40/)).toBeVisible();

    const search = page.getByRole('searchbox', { name: 'Search points of interest' });
    await search.fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await page.getByRole('button', { name: 'Jump to view' }).click();
    await expect(page.getByText('Focused on Registration Desk')).toBeVisible();
    // Jump lands on the POI approach point ([-3.1, 1.65, -1.1] fixture data).
    await expect(page.getByText(/X -3\.10 · Z -1\.10/)).toBeVisible();

    // Debounced pose persist (400 ms) + durable write settle.
    await page.waitForTimeout(1200);

    await page.reload();
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    // The saved pose replaces the manifest start position — honest restore.
    await expect(page.getByText(/X -3\.10 · Z -1\.10/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/X -4\.50 · Z 3\.40/)).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('leaves zero canvases on tab exit and remounts exactly one (single context)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);

    await page.getByTestId('tab-capture').click();
    await expect(page.locator('canvas')).toHaveCount(0);

    await page.getByTestId('tab-viewer').click();
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('switches scenes, resets the viewer and rejects a missing bundle with recovery', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'The Amber Hall' })).toBeVisible();

    await page.getByLabel('Choose demonstration scene').selectOption('/scenes/glb-fixture/manifest.json');
    await expect(page.getByRole('heading', { name: 'The Amber Hall · GLB asset' })).toBeVisible();
    await expect(page.getByText('Loaded Architectural GLB fixture')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.getByRole('button', { name: 'Reset viewpoint' }).click();
    await expect(page.getByText(/X -4\.50 · Z 3\.40/)).toBeVisible();

    await page.goto('/?scene=%2Fscenes%2Fmissing%2Fmanifest.json');
    await expect(page.getByRole('heading', { name: 'Scene bundle unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry scene load' })).toBeVisible();
  });

  test('keeps the UI usable when a GLB or manifest is malformed', async ({ page }) => {
    await page.route('**/scenes/glb-fixture/visual/architectural-fixture.glb', (route) => route.abort());
    await page.goto('/?scene=glb');
    await expect(page.getByRole('heading', { name: 'The Amber Hall · GLB asset' })).toBeVisible();
    await expect(page.getByText(/Visual asset unavailable/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('searchbox', { name: 'Search points of interest' })).toBeVisible();

    await page.unroute('**/scenes/glb-fixture/visual/architectural-fixture.glb');
    await page.route('**/scenes/fixture/manifest.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schemaVersion: 1 }) }));
    await page.goto('/?scene=%2Fscenes%2Ffixture%2Fmanifest.json');
    await expect(page.getByRole('heading', { name: 'Scene bundle unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry scene load' })).toBeVisible();
  });

  test('reports an unavailable route instead of drawing a fake path', async ({ page }) => {
    await page.route('**/scenes/fixture/navigation/nav-data.json', async (route) => {
      const response = await route.fetch();
      const navigation = await response.json() as { width: number; height: number; start: { x: number; z: number }; blocked: number[] };
      const startIndex = navigation.start.z * navigation.width + navigation.start.x;
      const goalIndex = 6 * navigation.width + 5;
      navigation.blocked = Array.from({ length: navigation.width * navigation.height }, (_, index) => index).filter((index) => index !== startIndex && index !== goalIndex);
      await route.fulfill({ response, json: navigation });
    });
    await page.goto('/');
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('searchbox', { name: 'Search points of interest' }).fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await page.getByRole('button', { name: /Plot walking route/ }).click();
    await expect(page.getByText(/No collision-safe route connects/)).toBeVisible();
  });
});

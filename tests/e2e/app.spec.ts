import { expect, test } from '@playwright/test';

test.describe('Namma Space browser journey', () => {
  test('loads the procedural scene, searches, selects, routes, jumps and stages media', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'The Amber Hall' })).toBeVisible();
    await expect(page.getByText('Ready to explore')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas[aria-label="The Amber Hall 3D viewer"]')).toBeVisible();

    const search = page.getByRole('textbox', { name: 'Search points of interest' });
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

    await page.getByLabel('Choose video or photo set').setInputFiles({
      name: 'walk.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('browser-e2e-fixture'),
    });
    await expect(page.getByText(/1 capture file staged/)).toBeVisible();

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
    await expect(page.getByRole('textbox', { name: 'Search points of interest' })).toBeVisible();

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
    await page.getByRole('textbox', { name: 'Search points of interest' }).fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await page.getByRole('button', { name: /Plot walking route/ }).click();
    await expect(page.getByText(/No collision-safe route connects/)).toBeVisible();
  });

  test('keeps the primary controls usable at a narrow viewport', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('textbox', { name: 'Search points of interest' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Enter walkthrough/ })).toBeVisible();
    await expect(page.getByText('Choose video or photo set', { exact: true })).toBeVisible();
    await context.close();
  });
});

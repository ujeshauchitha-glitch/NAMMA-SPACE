import { expect, test } from '@playwright/test';

/**
 * T24 §1 · workflow — the three-tab journey: stage real media in Capture
 * Studio (new room + assigned view group), search/plot/route/jump in the
 * Spatial Viewer, visit Live Scan, return to the studio, then RELOAD and
 * prove IndexedDB restored rooms, view groups, images and the camera pose
 * from durable storage alone.
 *
 * Fixture is generated in-test (valid 1×1 RGBA PNG) so the real sniff →
 * decode → resize → sha256 → IDB pipeline runs end to end in Chromium.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

test.describe('three-tab journey + IDB restore (T24)', () => {
  test('stages, routes, visits scan and restores rooms/groups/images/pose after a reload', async ({ page }) => {
    test.setTimeout(90_000); // three scene loads + reload + IDB hydration
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    /* ---- 1. Capture Studio: new room + staged, assigned image ---- */
    await page.goto('/?workspace=capture');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();

    await page.getByRole('button', { name: 'New room' }).click();
    await page.getByLabel('Room name').fill('Lab 201');
    await page.getByRole('button', { name: 'Create room' }).click();
    await expect(page.getByRole('button', { name: 'Lab 201', exact: true })).toBeVisible();

    await page.getByLabel('Choose capture images').setInputFiles({
      name: 'walk.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.getByText('1 image staged')).toBeVisible({ timeout: 15_000 });
    const thumb = page.getByRole('button', { name: 'Staged image 1' });
    await thumb.click();
    await page.getByLabel('Assign to view group').selectOption({ label: 'Front' });
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Front, 1 images' })).toBeVisible();

    /* ---- 2. Spatial Viewer: search → select → plot route → jump ---- */
    await page.getByTestId('tab-viewer').click();
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({ timeout: 15_000 });

    const search = page.getByRole('searchbox', { name: 'Search points of interest' });
    await search.fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await expect(page.getByText('Selected destination')).toBeVisible();

    await page.getByRole('button', { name: /Plot route/ }).click();
    await expect(page.getByText(/ROUTE · \d+(\.\d+)? m · \d+ cells · A\*/)).toBeVisible();

    await page.getByRole('button', { name: 'Jump to view' }).click();
    await expect(page.getByText('Focused on Registration Desk')).toBeVisible();
    await expect(page.getByText(/X -3\.10 · Z -1\.10/)).toBeVisible();

    // Debounced pose persist (400 ms) + durable write settle.
    await page.waitForTimeout(1200);

    /* ---- 3. Live Scan mounts, then back to the studio ---- */
    await page.getByTestId('tab-scan').click();
    await expect(page.getByTestId('workspace-scan')).toBeVisible();
    await expect(page.getByTestId('pair-card')).toBeVisible();

    await page.getByTestId('tab-capture').click();
    await expect(page.getByRole('button', { name: 'Lab 201', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Front, 1 images' })).toBeVisible();

    /* ---- 4. Reload — IndexedDB is the only memory left ---- */
    await page.reload();
    await expect(page.getByTestId('workspace-capture')).toBeVisible();

    // Rooms, view groups and staged images restored from the IDB snapshot.
    await expect(page.getByRole('button', { name: 'Lab 201', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Front, 1 images' })).toBeVisible();
    await expect(page.getByText('1 image staged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Staged image 1' })).toBeVisible();

    // The camera pose restored from IDB (honest restore: the saved pose
    // replaces the manifest start position — same contract as T14).
    await page.getByTestId('tab-viewer').click();
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/X -3\.10 · Z -1\.10/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/X -4\.50 · Z 3\.40/)).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});

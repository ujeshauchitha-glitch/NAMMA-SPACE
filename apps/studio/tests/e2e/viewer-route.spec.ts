import { expect, test } from '@playwright/test';

/**
 * T16 · route status strip + destination detail (§5.15–5.16) — plot → strip
 * readout → replot → clear, the honest unreachable path (A* detail verbatim,
 * warning row, single copy under strict mode), and Esc deselecting the
 * destination (§5.15).
 */

test.describe('Route status strip (T16)', () => {
  test('plots, replots and clears a verified route', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('searchbox', { name: 'Search points of interest' }).fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await expect(page.getByText('Selected destination')).toBeVisible();

    await page.getByRole('button', { name: 'Plot route' }).click();
    await expect(page.getByText(/ROUTE · \d+(\.\d+)? m · \d+ cells · A\*/)).toBeVisible();

    // Replot re-runs the same A* plot while the strip is showing.
    await page.getByRole('button', { name: 'Replot walking route' }).click();
    await expect(page.getByText(/ROUTE · \d+(\.\d+)? m · \d+ cells · A\*/)).toBeVisible();

    await page.getByRole('button', { name: 'Clear route' }).click();
    await expect(page.getByText(/ROUTE ·/)).toHaveCount(0);
    // Clearing hides the strip; the primary action remains the way back in.
    await page.getByRole('button', { name: 'Plot route' }).click();
    await expect(page.getByText(/ROUTE · \d+(\.\d+)? m · \d+ cells · A\*/)).toBeVisible();
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
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('searchbox', { name: 'Search points of interest' }).fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await page.getByRole('button', { name: 'Plot route' }).click();

    // A* detail verbatim in the strip, warning row per §5.15 — exactly one
    // copy each (strict-mode collision rule).
    await expect(page.getByText(/No collision-safe route connects/)).toHaveCount(1);
    await expect(page.getByText('▲ No walkable route — destination cell unreachable (blocked)')).toHaveCount(1);
    // No fake success readout.
    await expect(page.getByText(/ROUTE ·/)).toHaveCount(0);
  });

  test('Esc deselects the destination and clears the card', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('searchbox', { name: 'Search points of interest' }).fill('registration');
    await page.getByRole('option', { name: /Registration Desk/ }).click();
    await expect(page.getByText('Selected destination')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Selected destination')).toHaveCount(0);
  });
});

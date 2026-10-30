import { expect, test } from '@playwright/test';

/**
 * Release gate (deployed-build defect): the viewer canvas used to DOUBLE its
 * bitmap on every window resize. `.stage` had an auto height, the canvas'
 * `height: 100%` fell back to the bitmap's own size, the ResizeObserver
 * re-measured the inflated box and wrote a bigger bitmap — after ten resizes the
 * canvas was 1058 x 765 952 px and the view went black. The fix takes the canvas
 * out of flow and guards `resize()` against unchanged measurements; this spec
 * pins the invariant so it cannot regress silently again.
 */

test.describe('Viewer canvas sizing (release gate)', () => {
  test('the bitmap tracks the stage box across window resizes instead of growing unbounded', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({ timeout: 20_000 });

    const measure = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return null;
        const box = canvas.getBoundingClientRect();
        return {
          bitmapWidth: canvas.width,
          bitmapHeight: canvas.height,
          boxWidth: Math.round(box.width),
          boxHeight: Math.round(box.height),
          ratio: window.devicePixelRatio,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
        };
      });

    for (const size of [
      { width: 1280, height: 720 },
      { width: 1024, height: 1400 },
      { width: 1600, height: 760 },
    ]) {
      await page.setViewportSize(size);
      // ResizeObserver delivery + one rendered frame.
      await page.waitForTimeout(500);

      const measured = await measure();
      expect(measured).not.toBeNull();
      if (!measured) return;

      // The bitmap is the CSS box times the device pixel ratio, never a runaway.
      expect(measured.bitmapHeight).toBeLessThanOrEqual(Math.ceil(measured.boxHeight * measured.ratio) + 1);
      expect(measured.bitmapWidth).toBeLessThanOrEqual(Math.ceil(measured.boxWidth * measured.ratio) + 1);
      // The stage must not stretch the document: the old defect grew the page to
      // 766 175 px tall on a 900 px viewport.
      expect(measured.documentHeight).toBeLessThanOrEqual(measured.viewportHeight * 2);
    }

    // And the canvas is still the one live context inside the live stage.
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.getByRole('application', { name: /interactive 3D view/ })).toBeVisible();
  });
});

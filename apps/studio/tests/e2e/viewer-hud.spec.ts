import { expect, test, type Page } from '@playwright/test';

/**
 * T17 · over-canvas HUD (§5.19) — AC 1–7 from docs/V1_SPEC.md:246.
 *
 * Area is measured from the four `[data-hud-chrome]` corners only. The
 * auto-hide window is driven by Playwright's clock (installed AFTER goto so
 * the dev server and viewer boot stay on the real timeline) plus a synthetic
 * `pointerlockchange` — no real 4 s waits and no real pointer lock, which
 * headless Chromium refuses without a user gesture.
 */

const READY = { timeout: 30_000 } as const;

async function gotoReady(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible(READY);
}

/**
 * Point `document.pointerLockElement` at `document.body` (locked) or `null`
 * (unlocked) and fire the event the workspace hook listens for. The engine's
 * key guards treat anything other than the canvas as "not in walkthrough", so
 * `document.body` cannot steal WASD.
 */
async function synthesizeLock(page: Page, locked: boolean): Promise<void> {
  await page.evaluate((isLocked) => {
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => (isLocked ? document.body : null),
    });
    document.dispatchEvent(new Event('pointerlockchange'));
  }, locked);
}

test.describe('Spatial viewer HUD (T17)', () => {
  test('HUD chrome area is ≤ 15% of the viewport (AC 1)', async ({ page }) => {
    await gotoReady(page);
    const { count, ratio } = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[data-hud-chrome]'));
      const area = nodes.reduce((sum, node) => {
        const rect = node.getBoundingClientRect();
        return sum + rect.width * rect.height;
      }, 0);
      return {
        count: nodes.length,
        ratio: area / (window.innerWidth * window.innerHeight),
      };
    });
    expect(count).toBe(4);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(0.15);
  });

  test('hint auto-hides after the 4 s window and restores on unlock, returning focus (AC 2)', async ({ page }) => {
    await gotoReady(page);
    await page.clock.install();

    await synthesizeLock(page, true);
    await expect(page.getByRole('button', { name: 'Walkthrough active' })).toBeVisible();
    await expect(page.getByTestId('hud-hint')).toHaveAttribute('data-hint-visible', 'true');

    // The exact 3999/4000 boundary is unit-tested in tests/use-pointer-lock.test.tsx.
    // Playwright's clock, installed mid-session, can fire an already-scheduled
    // timer one tick early, so here we only assert the settled state past the
    // window.
    await page.clock.fastForward(5000);
    await expect(page.getByTestId('hud-hint')).toHaveAttribute('data-hint-visible', 'false');

    await synthesizeLock(page, false);
    await expect(page.getByTestId('hud-hint')).toHaveAttribute('data-hint-visible', 'true');
    await expect(page.getByRole('button', { name: 'Enter walkthrough' })).toBeFocused();
  });

  test('stage exposes role="application" and the visually-hidden polite live region (AC 3–4)', async ({ page }) => {
    await gotoReady(page);

    await expect(page.getByRole('application', { name: /interactive 3D view/ })).toBeVisible();

    const alt = page.getByTestId('hud-alt');
    await expect(alt).toHaveAttribute('aria-live', 'polite');
    await expect(alt).toHaveAttribute('role', 'status');
    await expect(alt).toContainText('Position X');
    await expect(alt).toContainText('Z');
  });

  test('reduced motion removes the corner rise and clamps the hint fade (AC 5)', async ({ page }) => {
    await gotoReady(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const cornerAnimation = await page
      .locator('[data-hud-chrome]')
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(cornerAnimation).toBe('none');

    const hintTransition = await page
      .getByTestId('hud-hint')
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { property: style.transitionProperty, duration: style.transitionDuration };
      });
    expect(hintTransition.property).toBe('opacity');
    // The base rule already transitions `opacity`, so the property alone would
    // pass with or without the clamp. The reduced-motion block in
    // Hud.module.css overrides the 160ms fade to `transition-duration: 1ms`,
    // which Chrome serialises as `0.001s` — assert that exact clamp.
    expect(hintTransition.duration).toBe('0.001s');
  });

  test('chips are pointer-events: none while buttons opt back in (AC 6)', async ({ page }) => {
    await gotoReady(page);

    const hintPointerEvents = await page
      .getByTestId('hud-hint')
      .evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(hintPointerEvents).toBe('none');

    const resetPointerEvents = await page
      .getByRole('button', { name: 'Reset viewpoint' })
      .evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(resetPointerEvents).toBe('auto');
  });

  test('coords use tabular numerals (AC 7)', async ({ page }) => {
    await gotoReady(page);

    const fontVariant = await page
      .getByTestId('hud-coords')
      .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    expect(fontVariant).toContain('tabular-nums');
  });

  test('focusable HUD controls show the halo focus ring (AC 6)', async ({ page }) => {
    await gotoReady(page);

    // Bounded Tab walk from the document start; the HUD sits after the header
    // so a 30-step cap is generous without hanging on a missed focus.
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press('Tab');
      const onReset = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute('aria-label') === 'Reset viewpoint';
      });
      if (onReset) break;
    }
    await expect(page.getByRole('button', { name: 'Reset viewpoint' })).toBeFocused();

    const boxShadow = await page
      .getByRole('button', { name: 'Reset viewpoint' })
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(boxShadow).not.toBe('none');
  });

  test('SIMULATED pill is present on the synthetic fixture and never dismissible (AC §5.19)', async ({ page }) => {
    await gotoReady(page);
    await expect(page.getByText('SIMULATED')).toBeVisible();
  });
});

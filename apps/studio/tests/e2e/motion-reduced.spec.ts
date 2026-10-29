import { expect, test } from '@playwright/test';

/**
 * T24 §6 · motion-reduced — `emulateMedia({ reducedMotion: 'reduce' })`
 * guards (T23 AC): a workspace tab switch must produce NO transform deltas
 * (no GSAP translate, no CSS transform keyframes/transitions), and the
 * scene skeleton must be a static fill (no sweep animation).
 *
 * The probe runs inside the page so sampling (every ~16 ms) and the tab
 * clicks happen on the same timeline — a sub-frame tween cannot slip between
 * "click" and "sample". A "transform delta" is an element MOVING between
 * consecutive samples (computed transform matrix changed): GSAP's reduced
 * path may still write inline `translate(0px, 0px)` instant cuts — those
 * resolve to an identity matrix and are not movement. Opacity-only fades
 * are allowed by §7.4 and are NOT transform deltas.
 */

test.use({ reducedMotion: 'reduce' });

declare global {
  interface Window {
    __motionProbe: { samples: number; maxMovedElements: number; clicked: string[] };
  }
}

test.describe('reduced motion (T23/T24)', () => {
  test('the scene skeleton is a static fill — no sweep animation runs', async ({ page }) => {
    // Hold the navigation fetch so the (real) loading skeleton is observable
    // instead of racing past it on localhost (same technique as T14).
    await page.route('**/scenes/fixture/navigation/nav-data.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.goto('/');

    const skeleton = page.getByTestId('scene-skeleton');
    await expect(skeleton).toBeVisible();
    // Every skeleton block must report `animation-name: none` — the reduced
    // fill from Skeleton.module.css, never the 1.2 s sweep.
    const animated = await skeleton.evaluate((root) =>
      Array.from(root.querySelectorAll('*'))
        .filter((element) => getComputedStyle(element).animationName !== 'none')
        .map((element) => element.className),
    );
    expect(animated, 'skeleton blocks are animating under reduced motion').toEqual([]);

    // The viewer still reaches its real ready state with the static skeleton.
    await expect(page.getByText('Ready to explore', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(skeleton).toHaveCount(0);
  });

  test('tab switches produce no transform deltas across all three workspaces', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('workspace-viewer')).toBeVisible();

    // Install the sampler and drive scan → capture → viewer tab switches from
    // INSIDE the page, so sampling and switching share one clock.
    //
    // "Transform delta" is measured as MOVEMENT: an element present in two
    // consecutive ~16 ms samples whose COMPUTED transform matrix changed.
    // This is exactly the reduced-motion contract (§7.4: no translation, no
    // stagger, instant cuts): an inline `translate(0px, 0px)` from an
    // instant gsap.set resolves to an identity matrix and is not movement;
    // a mounting element's first pose is not movement either — only a
    // tween/transition moving a mounted element between samples is.
    const probe = await page.evaluate(
      (): Promise<{ samples: number; maxMovedElements: number; clicked: string[] }> =>
        new Promise((resolve) => {
          const state = { samples: 0, maxMovedElements: 0, clicked: [] as string[] };
          window.__motionProbe = state;

          const readTransforms = (): Map<Element, string> => {
            const map = new Map<Element, string>();
            for (const element of document.querySelectorAll('*')) {
              const transform = getComputedStyle(element).transform;
              if (transform && transform !== 'none') map.set(element, transform);
            }
            return map;
          };

          let previous = readTransforms();
          const sampler = window.setInterval(() => {
            state.samples += 1;
            const current = readTransforms();
            let moved = 0;
            for (const [element, transform] of current) {
              const before = previous.get(element);
              if (before !== undefined && before !== transform) moved += 1;
            }
            state.maxMovedElements = Math.max(state.maxMovedElements, moved);
            previous = current;
          }, 16);

          const clickTab = (id: string): void => {
            const tab = document.querySelector<HTMLElement>(`[data-testid="tab-${id}"]`);
            if (!tab) throw new Error(`tab-${id} not found`);
            tab.click();
            state.clicked.push(id);
          };

          window.setTimeout(() => clickTab('scan'), 50);
          window.setTimeout(() => clickTab('capture'), 300);
          window.setTimeout(() => clickTab('viewer'), 550);
          window.setTimeout(() => {
            window.clearInterval(sampler);
            resolve(state);
          }, 900);
        }),
    );

    // All three switches really happened and the final workspace mounted.
    expect(probe.clicked).toEqual(['scan', 'capture', 'viewer']);
    await expect(page.getByTestId('workspace-viewer')).toBeVisible();
    // The probe genuinely sampled throughout the switch window …
    expect(probe.samples).toBeGreaterThan(20);
    // … and never saw an element move.
    expect(probe.maxMovedElements, 'an element moved (transform delta) during a tab switch').toBe(0);
  });
});

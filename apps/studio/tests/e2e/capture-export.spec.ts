import { expect, test } from '@playwright/test';

/**
 * T24 §2 · capture-export — the full Capture Studio pipeline into a real
 * browser download: upload → assign to a view group → coverage changes
 * shape → Export bundle → the download is intercepted and verified byte for
 * byte at its magic number, and the filename is the honest
 * `namma-space-prepared-capture-<timestamp>.zip` from
 * src/lib/capture/exportBundle.ts (never a browser-invented name).
 *
 * Fixture is generated in-test: a structurally valid 1×1 RGBA PNG so the
 * real sniff → decode → resize → sha256 → IDB pipeline runs in Chromium.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

/** Honest filename contract from bundleFileNameFor(): ISO-8601, ':'/'.' → '-'. */
const HONEST_ZIP_NAME = /^namma-space-prepared-capture-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/;

test.describe('capture → export bundle (T13/T24)', () => {
  test('exports a staged, assigned image as a real ZIP with the honest filename', async ({ page }) => {
    test.setTimeout(60_000); // real ingest pipeline + export + download settle
    await page.goto('/?workspace=capture');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();

    // Upload through the real ingest pipeline.
    await page.getByLabel('Choose capture images').setInputFiles({
      name: 'walk.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.getByText('1 image staged')).toBeVisible({ timeout: 15_000 });

    // Assign it to FRONT — the coverage shape changes with the real count.
    const coverage = page.getByRole('img', { name: /Category occupancy/ });
    await expect(coverage.locator('[data-state="occupied"]')).toHaveCount(0);
    const thumb = page.getByRole('button', { name: 'Staged image 1' });
    await thumb.click();
    await expect(thumb).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Assign to view group').selectOption({ label: 'Front' });
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Front, 1 images' })).toBeVisible();
    await expect(coverage.locator('[data-state="occupied"]')).toHaveCount(1);

    // Intercept the real download the Export button triggers.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export bundle' }).click();
    const download = await downloadPromise;

    // Honest filename — the app's own contract, not a browser default.
    expect(download.suggestedFilename()).toMatch(HONEST_ZIP_NAME);

    // Real bytes on disk: ZIP magic `PK\x03\x04`, size > 0.
    const filePath = await download.path();
    expect(filePath).not.toBeNull();
    const bytes = await import('node:fs').then((fs) => fs.readFileSync(filePath as string));
    expect(bytes.length).toBeGreaterThan(0);
    expect(
      [bytes[0], bytes[1], bytes[2], bytes[3]],
      'download is not a ZIP (missing PK\\x03\\x04 magic)',
    ).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // The success toast names the same honest file (single source of truth).
    await expect(page.getByText(`Bundle prepared — 1 image`)).toBeVisible();
    await expect(page.getByText(download.suggestedFilename())).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';

/**
 * T12 · Capture Studio workspace — e2e skeleton (room create + assign),
 * extended in T24. Fixtures are generated in-test: this is a structurally
 * valid 1×1 RGBA PNG (70 bytes, CRCs verified) so the real sniff → decode →
 * resize → sha256 → IndexedDB pipeline runs end to end in Chromium.
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TINY_PNG = Buffer.from(TINY_PNG_BASE64, 'base64');

test.describe('capture studio (T12)', () => {
  test('creates a room, stages an image and assigns it to FRONT', async ({ page }) => {
    await page.goto('/?workspace=capture');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();

    // Default room exists with the 8 §5.5 preset groups, all empty.
    await expect(page.getByRole('button', { name: 'Room 01', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Front, empty' })).toBeVisible();
    const coverage = page.getByRole('img', { name: /Category occupancy/ });
    await expect(coverage.locator('[data-state="occupied"]')).toHaveCount(0);

    // Keyboard-only upload: the file input is focusable behind the label.
    const upload = page.getByLabel('Choose capture images');
    await upload.focus();
    await expect(upload).toBeFocused();

    // Real ingest pipeline (sniff → decode → resize → sha256 → IDB).
    await upload.setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.getByText('1 image staged')).toBeVisible({ timeout: 15_000 });

    // Multi-select the thumbnail, assign it to FRONT, watch coverage change shape.
    const thumb = page.getByRole('button', { name: 'Staged image 1' });
    await expect(thumb).toBeVisible();
    await thumb.click();
    await expect(thumb).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Assign to view group').selectOption({ label: 'Front' });
    await page.getByRole('button', { name: 'Assign', exact: true }).click();

    await expect(page.getByRole('button', { name: 'Front, 1 images' })).toBeVisible();
    await expect(coverage.locator('[data-state="occupied"]')).toHaveCount(1);
  });

  test('deleting a room requires a confirm naming the room and its staged images', async ({ page }) => {
    await page.goto('/?workspace=capture');
    await expect(page.getByTestId('workspace-capture')).toBeVisible();

    // New room form → Lab 201 (auto-selected on create).
    await page.getByRole('button', { name: 'New room' }).click();
    await page.getByLabel('Room name').fill('Lab 201');
    await page.getByRole('button', { name: 'Create room' }).click();
    const roomRow = page.getByRole('button', { name: 'Lab 201', exact: true });
    await expect(roomRow).toBeVisible();

    // Stage one image and assign it to Lab 201's FRONT group.
    await page.getByLabel('Choose capture images').setInputFiles({
      name: 'frame.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await expect(page.getByText('1 image staged')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Staged image 1' }).click();
    await page.getByLabel('Assign to view group').selectOption({ label: 'Front' });
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Front, 1 images' })).toBeVisible();

    // Delete asks for confirmation that names the room and its staged image count.
    await page.getByRole('button', { name: 'Delete Lab 201' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete "Lab 201"');
    await expect(dialog).toContainText('1 staged image');

    // Cancel keeps everything.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(roomRow).toBeVisible();

    // Confirm deletes the room, its groups and the images staged into them.
    await page.getByRole('button', { name: 'Delete Lab 201' }).click();
    await page.getByRole('button', { name: 'Delete room', exact: true }).click();
    await expect(roomRow).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Staged image 1' })).toHaveCount(0);
  });
});

import { test, expect } from '@playwright/test';
import { DEFAULTS, filename, shareHash } from '../../src/cad/parameters';
test('build, inspect, download, change dimensions, and reload settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const step = page.getByRole('button', { name: 'Download STEP', exact: true });
  await expect(step).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('.render-host canvas')).toHaveCount(1);
  await expect(page.getByText('3D preview unavailable')).toHaveCount(0);
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Top', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Show edges', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await step.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(filename(DEFAULTS, 'step'));
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain('MANIFOLD_SOLID_BREP');
  await page.getByRole('spinbutton', { name: 'Tooth count', exact: true }).fill('36');
  await expect(step).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Bore diameter', exact: true }).fill('999');
  await page.getByRole('button', { name: 'Generate pulley', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('bore is too large');
  await expect(step).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Bore diameter', exact: true }).fill('12');
  await page.getByRole('button', { name: 'Generate pulley', exact: true }).click();
  await expect(step).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('.render-host canvas')).toHaveCount(1);
  const changed = { ...DEFAULTS, teeth: 36, bore: 12 };
  const saving = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await saving).suggestedFilename()).toBe(filename(changed, 'json'));
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'preset.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...DEFAULTS, teeth: 30, flanges: 'none' })),
    });
  await expect(page.getByRole('spinbutton', { name: 'Tooth count', exact: true })).toHaveValue(
    '30',
  );
  await expect(step).toBeDisabled();
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('shared dimensions work on a phone without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const p = {
    ...DEFAULTS,
    teeth: 32,
    bore: 12,
    flanges: 'none' as const,
    hub_diameter: 24,
    hub_length: 8,
  };
  await page.goto('/' + shareHash(p));
  await expect(page.getByRole('button', { name: 'Download STEP', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(page.getByRole('spinbutton', { name: 'Tooth count', exact: true })).toHaveValue(
    '32',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'STL', exact: true }).click();
  expect((await downloading).suggestedFilename()).toBe(filename(p, 'stl'));
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

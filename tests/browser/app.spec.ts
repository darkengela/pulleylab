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
  for (const mode of ['xray', 'wireframe', 'clay', 'solid']) {
    await page.getByRole('combobox', { name: 'Display style' }).selectOption(mode);
    await expect(page.locator('.viewer')).toHaveAttribute('data-display-mode', mode);
    await expect(step).toBeEnabled();
  }

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
  await page.locator('input[type=file]').setInputFiles({
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

test('live OD, shared nylon finish, and a complete drive/driven pair', async ({
  page,
  browser,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Download STEP', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await page.getByRole('spinbutton', { name: 'Tooth count', exact: true }).fill('30');
  await expect(page.getByLabel('Live pulley outside diameter')).toContainText('75.02');
  await expect(page.getByRole('button', { name: 'Download STEP', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Matte nylon preview' }).click();
  await page.getByRole('button', { name: 'Share build', exact: true }).click();
  const singleLink = await page.locator('.share-url').inputValue();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const other = await browser.newContext();
  const recipient = await other.newPage();
  await recipient.goto(singleLink);
  await expect(recipient.getByRole('button', { name: 'Download STEP', exact: true })).toBeEnabled({
    timeout: 60000,
  });
  await expect(recipient.locator('.viewer')).toHaveAttribute('data-finish', 'nylon');
  await expect(recipient.getByRole('spinbutton', { name: 'Tooth count', exact: true })).toHaveValue(
    '30',
  );
  await page.locator('.ratio-planner > summary').click();
  for (const [name, value] of [
    ['Drive minimum teeth', '24'],
    ['Drive maximum teeth', '24'],
    ['Driven minimum teeth', '72'],
    ['Driven maximum teeth', '72'],
    ['Driven shaft bore', '20'],
  ])
    await page.getByRole('spinbutton', { name, exact: true }).fill(value);
  await expect(page.getByRole('listbox', { name: 'Pulley configuration' })).toHaveValue('24-72');
  await page.getByRole('button', { name: 'Generate both pulleys', exact: true }).click();
  const zip = page.getByRole('button', { name: 'Download pair ZIP', exact: true });
  await expect(zip).toBeEnabled({ timeout: 90000 });
  await expect(page.getByRole('button', { name: 'Both pulleys', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Driven', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Driven', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const downloading = page.waitForEvent('download');
  await zip.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toContain('24T-Drive_72T-Driven_3to1');
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(Buffer.concat(chunks));
  const steps = Object.keys(files).filter((f) => f.endsWith('.step'));
  expect(steps).toHaveLength(2);
  expect(steps.some((f) => f.startsWith('DRIVE_') && f.includes('24Teeth'))).toBe(true);
  expect(
    steps.some((f) => f.startsWith('DRIVEN_') && f.includes('72Teeth') && f.includes('20mmBore')),
  ).toBe(true);
  for (const file of steps) expect(strFromU8(files[file])).toContain('MANIFOLD_SOLID_BREP');
  await page.getByRole('button', { name: 'Share build', exact: true }).click();
  const pairLink = await page.locator('.share-url').inputValue();
  await recipient.goto(pairLink);
  await expect(
    recipient.getByRole('button', { name: 'Download pair ZIP', exact: true }),
  ).toBeEnabled({ timeout: 90000 });
  await expect(recipient.locator('.viewer')).toHaveAttribute('data-finish', 'nylon');
  await other.close();
});

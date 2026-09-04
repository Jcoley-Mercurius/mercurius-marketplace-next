import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { syntheticSession } from '../fixtures/browser-session';

test.beforeEach(async ({ page }) => {
  await syntheticSession(page.context(), 'homeowner');
  await page.route('**/*', route => ['http://127.0.0.1:3103', 'http://127.0.0.1:55831'].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});
const review = '/checkout/00000000-0000-4000-8000-000000000030';
for (const theme of ['light', 'dark']) for (const width of [320, 1440]) {
  test(`money review ${theme} ${width}px: breakdown, confirmation, keyboard and failed provider launch`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto(review);
    await expect(page.getByRole('heading', { name: 'Review your payment' })).toBeVisible();
    await expect(page.getByText('M5-SYNTHETIC-001', { exact: false })).toBeVisible();
    await expect(page.getByRole('definition').filter({ hasText: '$117.00' }).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    expect(await page.getByRole('main').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const trigger = page.getByRole('button', { name: 'Continue with $117.00' });
    await trigger.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Continue to secure checkout?' });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await page.screenshot({ path: `test-results/money-${theme}-${width}.png`, fullPage: true });
    expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    await dialog.getByRole('button', { name: 'Continue to Stripe' }).click();
    await expect(dialog.getByRole('alert')).toBeFocused();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
test('deposit is not added to the total and the checkout return is not payment proof', async ({ page }) => {
  await page.goto(`${review}?mode=deposit&submitted=1`);
  await expect(page.getByRole('button', { name: 'Continue with $30.00' })).toBeVisible();
  await expect(page.getByText('Only confirmed payments', { exact: false })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: '$147.00' })).toHaveCount(0);
});
test('stale or expired snapshot cannot offer checkout', async ({ page }) => {
  await page.goto('/checkout/00000000-0000-4000-8000-000000000032');
  await expect(page.getByText('requires updated terms', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with/ })).toHaveCount(0);
});
test('another role cannot review homeowner payment', async ({ page }) => {
  await syntheticSession(page.context(), 'vendor');
  await page.goto(review);
  const error = page.getByRole('main').getByRole('alert');
  await expect(error).toContainText('unavailable');
  await expect(error).toBeFocused();
  await expect(page.getByRole('button', { name: /Continue with/ })).toHaveCount(0);
});

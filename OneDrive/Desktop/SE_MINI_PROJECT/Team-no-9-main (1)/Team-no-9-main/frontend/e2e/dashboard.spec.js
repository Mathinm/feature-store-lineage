// Dashboard checks at the TC-UX-01 widths, using the mock data source.
// Covers PWM-F-030 (#15), PWM-F-031 (#16) and PWM-NF-004 (#25).
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, expectNothingOffscreen, smallestFontSize, WIDTHS } from './helpers.js';

const STATES = ['', 'stale', 'empty', 'error'];

for (const width of WIDTHS) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const state of STATES) {
      test(`dashboard${state ? ` (${state})` : ''} fits the screen`, async ({ page }) => {
        await page.goto(state ? `/?mock=${state}` : '/');
        await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
        if (state === 'error') {
          await expect(page.getByRole('alert')).toBeVisible();
        } else {
          await expect(page.getByTestId('net-worth-value')).toBeVisible();
        }
        await expectNoHorizontalScroll(page);
        await expectNothingOffscreen(page);
      });
    }

    test('net worth and allocation are correct and readable', async ({ page }) => {
      await page.goto('/');
      // TC-Dash-01
      await expect(page.getByTestId('net-worth-value')).toHaveText('₹1,03,45,000.00');
      // TC-Dash-02
      const legend = page.getByTestId('allocation-legend');
      await expect(legend.locator('.legend-percent')).toHaveText(['79.27%', '11.60%', '6.23%', '2.90%']);
      await expect(page.getByRole('img', { name: /Asset allocation:/ })).toBeVisible();

      // Text stays readable: nothing in the dashboard (trend chart included) below 12px.
      await expect(page.getByTestId('trend-chart')).toBeVisible();
      expect(await smallestFontSize(page)).toBeGreaterThanOrEqual(12);
    });
  });
}

test('chart refreshes when assets change (PWM-F-031)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('net-worth-value')).toHaveText('₹1,03,45,000.00');

  // Edit a value: cash 2,50,000 -> 50,50,000, so net worth rises by 48,00,000.
  await page.evaluate(() => window.pwmMock.setValue('mock-ca-1', '5050000.00'));
  await expect(page.getByTestId('net-worth-value')).toHaveText('₹1,51,45,000.00');
  await expect(page.getByTestId('allocation-legend').locator('.legend-item').nth(1)).toContainText('Cash & bank');
  // PWM-F-032: today's point on the trend follows the change too.
  await expect(page.getByTestId('trend-chart')).toHaveAttribute('data-last-value', '15145000.00');

  // Delete a holding.
  await page.evaluate(() => window.pwmMock.remove('mock-re-2'));
  await expect(page.getByTestId('net-worth-value')).toHaveText('₹1,34,45,000.00');

  // Percentages still total exactly 100.00.
  const total = await page
    .getByTestId('allocation-legend')
    .locator('.legend-percent')
    .evaluateAll((els) => els.reduce((sum, el) => sum + Math.round(parseFloat(el.textContent) * 100), 0));
  expect(total).toBe(10000);
});

test('legend can be reached with the keyboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('allocation-legend')).toBeVisible();
  const first = page.getByTestId('allocation-legend').locator('.legend-item').first();
  await first.focus();
  await expect(first).toHaveClass(/active/);
});

// Historical net-worth chart (PWM-F-032, #17; TC-Dash-03), using the mock snapshots.
import { expect, test } from '@playwright/test';
import { expectFitsScreen, todayIST, WIDTHS } from './helpers.js';
import { addMonths, formatWeekdayDate, fromDayNumber, rangeStart, toDayNumber } from '../src/lib/trend.js';

const RANGES = [
  { label: '1M', id: '1M' },
  { label: '6M', id: '6M' },
  { label: '1Y', id: '1Y' },
  { label: 'All', id: 'ALL' },
];

const chart = (page) => page.getByTestId('trend-chart');

/** Hover the chart at a point `fraction` of the way across (0 = left edge, 1 = right edge). */
async function hoverChart(page, fraction) {
  const svg = chart(page).locator('svg');
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + 2 + fraction * (box.width - 4), box.y + box.height / 2);
}
const rangeButton = (page, label) => page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: label, exact: true });

test('TC-Dash-03: each range redraws the chart with the correct points', async ({ page }) => {
  const today = todayIST();
  await page.goto('/');
  await expect(chart(page)).toBeVisible();

  const seen = {};
  for (const { label, id } of RANGES) {
    await rangeButton(page, label).click();
    await expect(rangeButton(page, label)).toHaveAttribute('aria-pressed', 'true');
    await expect(chart(page)).toHaveAttribute('data-range', id);

    // Mock history covers 24 months, so ALL starts 24 months back.
    const start = rangeStart(id, today) ?? addMonths(today, -24);
    const expectedCount = toDayNumber(today) - toDayNumber(start) + 1;
    await expect(chart(page)).toHaveAttribute('data-first-date', start);
    await expect(chart(page)).toHaveAttribute('data-last-date', today);
    await expect(chart(page)).toHaveAttribute('data-point-count', String(expectedCount));

    seen[id] = {
      path: await chart(page).locator('.trend-line').getAttribute('d'),
      xLabels: await chart(page).locator('.trend-x-label').allTextContents(),
      change: await page.getByTestId('trend-change').textContent(),
    };
  }

  // Every range draws a different line, with different date labels.
  expect(new Set(Object.values(seen).map((s) => s.path)).size).toBe(4);
  expect(new Set(Object.values(seen).map((s) => s.xLabels.join('|'))).size).toBe(4);
  expect(seen.ALL.change).toMatch(/since \d{1,2} \w+ \d{4}/);
  expect(seen['1M'].change).toMatch(/^[▲▼■] [+−]?₹[\d,]+\.\d{2}( \([+−]?\d+\.\d{2}%\))? in the past month$/);
});

test('tooltip shows the exact date and full ₹ amount on hover and with the keyboard', async ({ page }) => {
  const today = todayIST();
  await page.goto('/');
  await expect(chart(page)).toBeVisible();
  const tooltip = page.getByTestId('trend-tooltip');

  // Hover at the right edge: today's point, which is the current net worth.
  await hoverChart(page, 1);
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(formatWeekdayDate(today));
  await expect(tooltip).toContainText('₹1,03,45,000.00');

  // Keyboard: Home goes to the first day, ArrowRight to the next one, End back to today.
  await page.mouse.move(0, 0);
  await chart(page).focus();
  await page.keyboard.press('Home');
  const first = await chart(page).getAttribute('data-first-date');
  await expect(chart(page)).toHaveAttribute('data-active-date', first);
  await page.keyboard.press('ArrowRight');
  const second = fromDayNumber(toDayNumber(first) + 1);
  await expect(chart(page)).toHaveAttribute('data-active-date', second);
  await expect(tooltip).toContainText(formatWeekdayDate(second));
  await expect(tooltip).toContainText(/₹[\d,]+\.\d{2}/);
  await page.keyboard.press('End');
  await expect(chart(page)).toHaveAttribute('data-active-date', today);
});

test('shows a clear empty state when there is no history yet', async ({ page }) => {
  await page.goto('/?mock=trend-empty');
  await expect(page.getByTestId('trend-empty')).toContainText('No history for this period yet');
  await expect(chart(page)).toHaveCount(0);

  // A brand-new user: empty dashboard and empty trend.
  await page.goto('/?mock=empty');
  await expect(page.getByTestId('trend-empty')).toBeVisible();
});

test('shows an error with a retry when the trend cannot load', async ({ page }) => {
  await page.goto('/?mock=trend-error');
  const trendCard = page.locator('section.trend');
  await expect(trendCard.getByRole('alert')).toContainText("We couldn't load your net-worth history");
  await expect(trendCard.getByRole('button', { name: 'Try again' })).toBeVisible();
  // The rest of the dashboard still works.
  await expect(page.getByTestId('net-worth-value')).toHaveText('₹1,03,45,000.00');
});

test('a 401 asks the user to log in again and shows no data', async ({ page }) => {
  await page.goto('/?mock=unauth');
  const notice = page.getByTestId('session-expired');
  await expect(notice).toContainText('Please log in again');
  await expect(page.getByTestId('net-worth-value')).toHaveCount(0);
  await expect(chart(page)).toHaveCount(0);
  await notice.getByRole('link', { name: 'Go to login' }).click();
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});

for (const width of WIDTHS) {
  for (const state of ['trend-empty', 'trend-error', 'unauth']) {
    test(`dashboard (${state}) fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/?mock=${state}`);
      const marker = {
        'trend-empty': page.getByTestId('trend-empty'),
        'trend-error': page.locator('section.trend').getByRole('alert'),
        unauth: page.getByTestId('session-expired'),
      }[state];
      await expect(marker).toBeVisible();
      await expectFitsScreen(page);
    });
  }

  test(`trend chart fits at ${width}px, with the tooltip open at either edge`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(chart(page)).toBeVisible();
    await expectFitsScreen(page);

    for (const fraction of [0, 0.5, 1]) {
      await hoverChart(page, fraction);
      await expect(page.getByTestId('trend-tooltip')).toBeVisible();
      await expectFitsScreen(page);
    }
  });
}

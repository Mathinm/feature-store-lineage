// Shared checks for the responsive tests (PWM-NF-004 / TC-UX-01).
import { expect } from '@playwright/test';

export const WIDTHS = [360, 768, 1280];

export async function expectNoHorizontalScroll(page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'page must not scroll sideways').toBeLessThanOrEqual(clientWidth);
}

/** Every element inside the page must stay within the viewport (except the nav strip, which scrolls by design). */
export async function expectNothingOffscreen(page) {
  const offenders = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll('main *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5);
      })
      .map((el) => el.getAttribute('class') || el.tagName);
  });
  expect(offenders, 'elements overflowing the viewport').toEqual([]);
}

export async function expectFitsScreen(page) {
  await expectNoHorizontalScroll(page);
  await expectNothingOffscreen(page);
}

/** Smallest computed font size of any element in the page that directly holds text. */
export async function smallestFontSize(page) {
  return page.evaluate(() =>
    Math.min(
      ...[...document.querySelectorAll('main *')]
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .map((el) => parseFloat(getComputedStyle(el).fontSize)),
    ),
  );
}

/** Change the hash without reloading, so the in-memory mock data survives. */
export async function goToHash(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

/** Today's date in India as 'YYYY-MM-DD', matching the mock snapshots. */
export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

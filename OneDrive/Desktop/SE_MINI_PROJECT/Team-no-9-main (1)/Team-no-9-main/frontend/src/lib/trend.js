// Net-worth trend helpers (PWM-F-032): date ranges, axis scaling and the change
// over a range. Dates are 'YYYY-MM-DD' strings for the IST calendar day, the same
// form GET /api/dashboard/trend returns, so plain string comparison orders them.

import { fromPaise, toPaise } from './money.js';

export const RANGES = [
  { id: '1M', label: '1M', months: 1, period: 'in the past month' },
  { id: '6M', label: '6M', months: 6, period: 'in the past 6 months' },
  { id: '1Y', label: '1Y', months: 12, period: 'in the past year' },
  { id: 'ALL', label: 'All', months: null, period: null },
];

export const DEFAULT_RANGE = '1Y';

const DAY_MS = 86_400_000;

const istDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in India as 'YYYY-MM-DD'; one snapshot is kept per IST day. */
export function todayIST(now = new Date()) {
  return istDay.format(now);
}

/** Whole days since 1970-01-01 for a 'YYYY-MM-DD' date. */
export function toDayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The same day `months` months later (negative for earlier), clamped to the end
 * of a shorter month: 2026-03-31 minus 1 month is 2026-02-28.
 */
export function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** First date included in a range that ends on `today`, or null for ALL. */
export function rangeStart(range, today) {
  const def = RANGES.find((r) => r.id === range);
  if (!def) throw new Error(`Unknown range: ${range}`);
  return def.months === null ? null : addMonths(today, -def.months);
}

/** Points dated from the range start to today inclusive, oldest first. */
export function filterRange(points, range, today) {
  const start = rangeStart(range, today);
  return points
    .filter((p) => (start === null || p.date >= start) && p.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Value-axis ticks covering [min, max] with at most `maxTicks` ticks. Steps are
 * 1, 2 or 5 x 10^n so the lakh / crore labels stay round. The axis does not start
 * at zero, so day-to-day changes stay visible; a flat series gets a small band.
 */
export function niceTicks(min, max, maxTicks = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new Error('niceTicks needs finite numbers');
  if (min > max) [min, max] = [max, min];
  // Keep the band at least 1% of the value (and ₹100). Otherwise a nearly flat
  // series (₹50 of change on ₹1 crore) gets ticks a few rupees apart, every lakh /
  // crore label reads the same, and the tiny wobble fills the whole chart height.
  const minSpan = Math.max(Math.abs(max) * 0.01, 100);
  if (max - min < minSpan) {
    const nonNegative = min >= 0;
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
    if (nonNegative && min < 0) {
      max -= min;
      min = 0;
    }
  }

  const rough = (max - min) / Math.max(maxTicks - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = magnitude;
  for (const multiple of [1, 2, 5, 10, 20, 50]) {
    step = multiple * magnitude;
    if (step >= rough && Math.ceil(max / step) - Math.floor(min / step) + 1 <= maxTicks) break;
  }

  const ticks = [];
  for (let k = Math.floor(min / step); k <= Math.ceil(max / step); k++) {
    ticks.push(Number((k * step).toPrecision(12)));
  }
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks };
}

/**
 * Value-axis label in rupees, lakh or crore. `scaleMax` (the top tick) picks one
 * unit for the whole axis; `step` decides how many decimals keep labels distinct.
 * formatAxisINR(10200000, 200000, 10400000) -> "₹1.02 Cr".
 */
export function formatAxisINR(value, step, scaleMax = value) {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const unit = scaleMax >= 1e7 ? { size: 1e7, suffix: ' Cr' } : scaleMax >= 1e5 ? { size: 1e5, suffix: ' L' } : null;
  if (!unit) return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;

  const decimals = Math.min(4, Math.max(0, Math.ceil(Math.log10(unit.size / step) - 1e-9)));
  let text = (abs / unit.size).toFixed(decimals);
  if (decimals > 0) text = text.replace(/\.?0+$/, '');
  return `${sign}₹${text}${unit.suffix}`;
}

/** `count` evenly spaced dates from the first point to the last, for axis labels. */
export function dateTicks(points, count) {
  if (points.length === 0) return [];
  const first = toDayNumber(points[0].date);
  const last = toDayNumber(points[points.length - 1].date);
  if (first === last || count < 2) return [points[0].date];
  const n = Math.min(count, last - first + 1);
  return Array.from({ length: n }, (_, i) => fromDayNumber(Math.round(first + (i * (last - first)) / (n - 1))));
}

/** Index of the value in an ascending list closest to `x` (used to pick the hovered day). */
export function nearestIndex(sorted, x) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(sorted[hi] - x) < Math.abs(sorted[lo] - x) ? hi : lo;
}

const utc = (date) => new Date(`${date}T00:00:00Z`);
const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
// Four-digit year: "Oct 25" would read as 25 October next to the "19 Oct" day labels.
const monthYear = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const weekdayDate = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Short axis label: "19 Oct" for spans up to about 6 months, "Oct 2026" beyond. */
export function formatAxisDate(date, spanDays) {
  return (spanDays <= 200 ? dayMonth : monthYear).format(utc(date));
}

/** "19 Oct 2026" */
export function formatLongDate(date) {
  return longDate.format(utc(date));
}

/** "Mon, 19 Oct 2026" (tooltip) */
export function formatWeekdayDate(date) {
  return weekdayDate.format(utc(date));
}

/**
 * Change from the first point to the last, computed exactly in paise.
 * Returns { amount: "-452300.00", percent: "-4.37" | null, direction: 'up' | 'down' | 'flat' },
 * or null with fewer than two points. Percent is rounded half away from zero to
 * 2 decimals, and is null when the starting value is 0.
 */
export function computeChange(points) {
  if (points.length < 2) return null;
  const start = toPaise(points[0].netWorth);
  const end = toPaise(points[points.length - 1].netWorth);
  const diff = end - start;
  return {
    amount: fromPaise(diff),
    percent: start > 0n ? bpsToPercent(divideRounded(diff * 10000n, start)) : null,
    direction: diff > 0n ? 'up' : diff < 0n ? 'down' : 'flat',
  };
}

function divideRounded(numerator, denominator) {
  const abs = numerator < 0n ? -numerator : numerator;
  const quotient = (abs * 2n + denominator) / (denominator * 2n);
  return numerator < 0n ? -quotient : quotient;
}

function bpsToPercent(bps) {
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

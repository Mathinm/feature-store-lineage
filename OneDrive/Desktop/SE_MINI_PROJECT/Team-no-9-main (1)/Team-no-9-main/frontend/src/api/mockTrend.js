// Mock net_worth_snapshots, used until GET /api/dashboard/trend exists.
// About two years of daily totals ending today. The history comes from a fixed
// seed, so it is the same on every load and in tests. Only today's point is live:
// it is the current total of the mock asset store, just as the real API upserts
// today's snapshot whenever an asset changes (SAD 4.5).

import { computeNetWorth } from '../lib/dashboard.js';
import { addMonths, filterRange, fromDayNumber, toDayNumber, todayIST } from '../lib/trend.js';
import { MOCK_ASSETS } from './mockAssets.js';

const HISTORY_MONTHS = 24;
const SEED = 20261019;

let cache = null; // { today, history } where history excludes today's point

/** Snapshots for `range`, oldest first, ending today with `currentNetWorth`. */
export function mockTrendPoints(range, currentNetWorth, today = todayIST()) {
  if (cache?.today !== today) cache = { today, history: generateHistory(today) };
  return filterRange([...cache.history, { date: today, netWorth: currentNetWorth }], range, today);
}

// Walk backwards from the sample portfolio's total: a gentle upward drift with
// daily noise, plus two step changes where a holding was bought.
function generateHistory(today) {
  const random = mulberry32(SEED);
  const end = toDayNumber(today);
  const start = toDayNumber(addMonths(today, -HISTORY_MONTHS));
  const base = Number(computeNetWorth(MOCK_ASSETS));

  const history = [];
  let factor = 1;
  for (let day = end - 1; day >= start; day--) {
    const daysAgo = end - day;
    factor /= 1 + 0.00035 + (random() - 0.5) * 0.008;
    if (daysAgo === 140) factor *= 0.95; // gold bought ~4.5 months ago
    if (daysAgo === 470) factor *= 0.9; // plot bought ~15 months ago
    const rupees = Math.round(base * factor);
    history.push({ date: fromDayNumber(day), netWorth: `${rupees}.00` });
  }
  return history.reverse();
}

// Small seeded PRNG (mulberry32) so the mock history is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

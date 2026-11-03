// Dashboard calculations (PWM-F-030, PWM-F-031).
// These mirror the rules in SAD section 4.5 so the frontend mock and the future
// backend DashboardModule produce the same numbers:
//   - Net worth = sum of current_value over the user's non-deleted assets.
//   - Allocation = class value / net worth, rounded to 2 decimals; the rounding
//     remainder is added to the largest slice so the total is exactly 100.00.

import { toPaise, fromPaise, sumMoney } from './money.js';
import { ASSET_TYPE_ORDER } from './assetTypes.js';

/** PWM-F-030: total net worth of all non-deleted assets, as a decimal string. */
export function computeNetWorth(assets) {
  return sumMoney(activeAssets(assets).map((a) => a.currentValue));
}

/**
 * PWM-F-031: allocation by asset class.
 * Returns [{ assetType, value, percent }] sorted by value (largest first), with
 * percent as a 2-decimal string. Classes with no value are left out.
 */
export function computeAllocation(assets) {
  const byType = new Map();
  for (const asset of activeAssets(assets)) {
    const prev = byType.get(asset.assetType) ?? 0n;
    byType.set(asset.assetType, prev + toPaise(asset.currentValue));
  }

  const slices = [...byType.entries()]
    .filter(([, paise]) => paise > 0n)
    .map(([assetType, paise]) => ({ assetType, paise }));

  const total = slices.reduce((sum, s) => sum + s.paise, 0n);
  if (total === 0n) return [];

  // Work in basis points (1/100 of a percent) so 100.00% == 10000 exactly.
  for (const s of slices) {
    s.bps = roundHalfUp(s.paise * 10000n, total);
  }

  slices.sort(
    (a, b) =>
      compareBigInt(b.paise, a.paise) ||
      ASSET_TYPE_ORDER.indexOf(a.assetType) - ASSET_TYPE_ORDER.indexOf(b.assetType),
  );

  // Rounding remainder (can be negative) goes to the largest slice.
  const remainder = 10000n - slices.reduce((sum, s) => sum + s.bps, 0n);
  slices[0].bps += remainder;

  return slices.map((s) => ({
    assetType: s.assetType,
    value: fromPaise(s.paise),
    percent: bpsToPercent(s.bps),
  }));
}

/** True if any market-priced asset is using a stale cached price (PWM-F-024). */
export function hasStaleData(assets) {
  return activeAssets(assets).some((a) => a.isStale === true);
}

/** Build the GET /api/dashboard response shape (SAD 4.3.3) from a list of assets. */
export function buildDashboard(assets, asOf = new Date().toISOString()) {
  return {
    netWorth: computeNetWorth(assets),
    currency: 'INR',
    asOf,
    hasStaleData: hasStaleData(assets),
    allocation: computeAllocation(assets),
  };
}

function activeAssets(assets) {
  return assets.filter((a) => !a.deletedAt);
}

function roundHalfUp(numerator, denominator) {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function compareBigInt(a, b) {
  return a > b ? 1 : a < b ? -1 : 0;
}

function bpsToPercent(bps) {
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

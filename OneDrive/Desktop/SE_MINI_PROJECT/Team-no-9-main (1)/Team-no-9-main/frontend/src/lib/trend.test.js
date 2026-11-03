import { describe, expect, it } from 'vitest';
import {
  addMonths,
  computeChange,
  dateTicks,
  filterRange,
  formatAxisDate,
  formatAxisINR,
  fromDayNumber,
  nearestIndex,
  niceTicks,
  rangeStart,
  toDayNumber,
  todayIST,
} from './trend.js';
import { mockTrendPoints } from '../api/mockTrend.js';

const TODAY = '2026-10-19';

/** One point per day from `from` to `to`, values rising by ₹1,000 a day. */
function dailyPoints(from, to) {
  const points = [];
  for (let day = toDayNumber(from), i = 0; day <= toDayNumber(to); day++, i++) {
    points.push({ date: fromDayNumber(day), netWorth: `${10000000 + i * 1000}.00` });
  }
  return points;
}

describe('dates', () => {
  it('uses the IST calendar day for "today"', () => {
    // 20:00 UTC on 18 Oct is 01:30 IST on 19 Oct.
    expect(todayIST(new Date('2026-10-18T20:00:00Z'))).toBe('2026-10-19');
    expect(todayIST(new Date('2026-10-18T18:00:00Z'))).toBe('2026-10-18');
  });

  it('subtracts calendar months and clamps to the end of shorter months', () => {
    expect(addMonths('2026-10-19', -1)).toBe('2026-09-19');
    expect(addMonths('2026-10-19', -12)).toBe('2025-10-19');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2024-03-31', -1)).toBe('2024-02-29');
  });
});

describe('TC-Dash-03 / PWM-F-032: range filtering', () => {
  const twoYears = dailyPoints('2024-10-19', TODAY);

  it('starts each range on the right day', () => {
    expect(rangeStart('1M', TODAY)).toBe('2026-09-19');
    expect(rangeStart('6M', TODAY)).toBe('2026-04-19');
    expect(rangeStart('1Y', TODAY)).toBe('2025-10-19');
    expect(rangeStart('ALL', TODAY)).toBeNull();
    expect(() => rangeStart('2W', TODAY)).toThrow();
  });

  it('returns the right points for 1M, 6M, 1Y and All', () => {
    const counts = {};
    for (const range of ['1M', '6M', '1Y', 'ALL']) {
      const points = filterRange(twoYears, range, TODAY);
      counts[range] = points.length;
      expect(points.at(-1).date).toBe(TODAY);
      expect(points[0].date).toBe(rangeStart(range, TODAY) ?? '2024-10-19');
    }
    // Both ends inclusive: 30 days back plus today, and so on.
    expect(counts).toEqual({ '1M': 31, '6M': 184, '1Y': 366, ALL: 731 });
  });

  it('sorts oldest first and leaves out future dates', () => {
    const shuffled = [...dailyPoints('2026-09-01', '2026-10-25')].reverse();
    const points = filterRange(shuffled, '1M', TODAY);
    expect(points[0].date).toBe('2026-09-19');
    expect(points.at(-1).date).toBe(TODAY);
    expect(points.every((p, i) => i === 0 || points[i - 1].date < p.date)).toBe(true);
  });

  it('copes with gaps and with history shorter than the range', () => {
    const sparse = [
      { date: '2026-10-01', netWorth: '100.00' },
      { date: '2026-10-10', netWorth: '200.00' },
      { date: TODAY, netWorth: '300.00' },
    ];
    expect(filterRange(sparse, '1Y', TODAY)).toHaveLength(3);
    expect(filterRange(sparse, 'ALL', TODAY)).toHaveLength(3);
    expect(filterRange([], '1M', TODAY)).toEqual([]);
  });
});

describe('PWM-F-032: value axis scaling', () => {
  const isNiceStep = (step) => {
    const normalised = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
    return [1, 2, 5].some((n) => Math.abs(normalised - n) < 1e-9);
  };

  it('covers the data with round steps', () => {
    const scale = niceTicks(10123000, 10345000, 5);
    expect(scale).toMatchObject({ step: 100000, min: 10100000, max: 10400000 });
    expect(scale.ticks).toEqual([10100000, 10200000, 10300000, 10400000]);
  });

  it('always covers [min, max] with at most maxTicks evenly spaced ticks', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) {
      const a = random() * 1e8;
      const b = a + random() * 1e7 + 1;
      const maxTicks = 4 + (i % 3);
      const { ticks, step } = niceTicks(a, b, maxTicks);
      expect(ticks[0]).toBeLessThanOrEqual(a);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(b);
      expect(ticks.length).toBeLessThanOrEqual(maxTicks);
      expect(isNiceStep(step)).toBe(true);
    }
  });

  it('gives a flat series a band around it, never below zero', () => {
    const flat = niceTicks(500000, 500000);
    expect(flat.min).toBeLessThan(500000);
    expect(flat.max).toBeGreaterThan(500000);
    expect(niceTicks(0, 0).min).toBe(0);
    expect(niceTicks(0, 30).min).toBe(0);
  });

  it('keeps labels distinct for a nearly flat series', () => {
    // ₹50 of change on ₹1.03 crore, half a rupee, and 40 paise on ₹500.
    for (const [min, max] of [
      [10345000, 10345050],
      [10345000, 10345000.5],
      [500, 500.4],
    ]) {
      const scale = niceTicks(min, max, 4);
      const labels = scale.ticks.map((t) => formatAxisINR(t, scale.step, scale.max));
      expect(new Set(labels).size, labels.join(', ')).toBe(labels.length);
      expect(scale.ticks[0]).toBeLessThanOrEqual(min);
      expect(scale.ticks.at(-1)).toBeGreaterThanOrEqual(max);
      // The band is at least 1% of the value, so a tiny wobble doesn't fill the chart.
      expect(scale.max - scale.min).toBeGreaterThanOrEqual(Math.max(max * 0.01, 100));
    }
  });

  it('labels the axis in lakh or crore with enough decimals to stay distinct', () => {
    expect(formatAxisINR(10200000, 200000, 10400000)).toBe('₹1.02 Cr');
    expect(formatAxisINR(10000000, 1000000, 12000000)).toBe('₹1 Cr');
    expect(formatAxisINR(100000000, 10000000, 200000000)).toBe('₹10 Cr');
    expect(formatAxisINR(9800000, 200000, 10400000)).toBe('₹0.98 Cr');
    expect(formatAxisINR(650000, 50000, 900000)).toBe('₹6.5 L');
    expect(formatAxisINR(500000, 100000, 900000)).toBe('₹5 L');
    expect(formatAxisINR(45000, 5000, 60000)).toBe('₹45,000');

    for (const [min, max] of [
      [10123000, 10345000],
      [10300000, 10345000],
      [7800000, 10345000],
      [640000, 655000],
      [1000, 1500],
    ]) {
      const scale = niceTicks(min, max, 5);
      const labels = scale.ticks.map((t) => formatAxisINR(t, scale.step, scale.max));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe('date axis and tooltip helpers', () => {
  it('spreads date labels evenly from the first day to the last', () => {
    const month = dailyPoints('2026-09-19', TODAY);
    expect(dateTicks(month, 3)).toEqual(['2026-09-19', '2026-10-04', TODAY]);
    expect(dateTicks(month.slice(0, 2), 6)).toEqual(['2026-09-19', '2026-09-20']);
    expect(dateTicks([], 3)).toEqual([]);
  });

  it('formats axis dates by span', () => {
    expect(formatAxisDate(TODAY, 30)).toBe('19 Oct');
    expect(formatAxisDate(TODAY, 400)).toMatch(/^Oct\w* 2026$/);
  });

  it('finds the nearest point to the pointer', () => {
    const xs = [0, 10, 20, 30];
    expect(nearestIndex(xs, 14)).toBe(1);
    expect(nearestIndex(xs, 16)).toBe(2);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex([5], 0)).toBe(0);
  });
});

describe('change over the selected range', () => {
  const pts = (...values) => values.map((netWorth, i) => ({ date: fromDayNumber(20000 + i), netWorth }));

  it('reports the exact rupee and percent change', () => {
    expect(computeChange(pts('100000.00', '104570.00'))).toEqual({
      amount: '4570.00',
      percent: '4.57',
      direction: 'up',
    });
    // 455000 / 10345000 = 4.398%, rounded to 4.40.
    expect(computeChange(pts('10345000.00', '10000000.00', '9890000.00'))).toEqual({
      amount: '-455000.00',
      percent: '-4.40',
      direction: 'down',
    });
    expect(computeChange(pts('0.10', '0.30'))).toMatchObject({ amount: '0.20', percent: '200.00' });
  });

  it('handles flat, zero-start and too-short series', () => {
    expect(computeChange(pts('500.00', '500.00'))).toEqual({ amount: '0.00', percent: '0.00', direction: 'flat' });
    expect(computeChange(pts('0.00', '500.00')).percent).toBeNull();
    expect(computeChange(pts('500.00'))).toBeNull();
  });
});

describe('mock snapshots (until GET /api/dashboard/trend exists)', () => {
  it('has about two years of daily points ending at the current net worth', () => {
    const all = mockTrendPoints('ALL', '12345678.00', TODAY);
    expect(all[0].date).toBe('2024-10-19');
    expect(all).toHaveLength(731);
    expect(all.at(-1)).toEqual({ date: TODAY, netWorth: '12345678.00' });
    expect(mockTrendPoints('1M', '12345678.00', TODAY)).toHaveLength(31);
  });

  it('keeps history fixed and only moves today when assets change', () => {
    const before = mockTrendPoints('6M', '10345000.00', TODAY);
    const after = mockTrendPoints('6M', '15145000.00', TODAY);
    expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
    expect(after.at(-1).netWorth).toBe('15145000.00');
  });
});

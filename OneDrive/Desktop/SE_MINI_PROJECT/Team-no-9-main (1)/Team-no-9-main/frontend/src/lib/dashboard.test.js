import { describe, expect, it } from 'vitest';
import { buildDashboard, computeAllocation, computeNetWorth, hasStaleData } from './dashboard.js';
import { formatINR, formatINRCompact, sumMoney, toPaise } from './money.js';
import { MOCK_ASSETS, MOCK_ASSETS_STALE } from '../api/mockAssets.js';

const asset = (assetType, currentValue, extra = {}) => ({ assetType, currentValue, ...extra });

const sumPercents = (allocation) =>
  allocation.reduce((total, s) => total + Math.round(Number(s.percent) * 100), 0);

describe('TC-Dash-01 / PWM-F-030: net worth total', () => {
  it('equals the sum of current values across all four asset classes', () => {
    const assets = [
      asset('REAL_ESTATE', '8200000.00'),
      asset('STOCK', '1200000.00'),
      asset('GOLD', '645000.00'),
      asset('CASH', '300000.00'),
    ];
    expect(computeNetWorth(assets)).toBe('10345000.00');
  });

  it('ignores deleted assets', () => {
    const assets = [asset('CASH', '100.00'), asset('CASH', '50.00', { deletedAt: '2026-10-01' })];
    expect(computeNetWorth(assets)).toBe('100.00');
  });

  it('adds paise exactly, without floating-point drift', () => {
    expect(computeNetWorth([asset('CASH', '0.10'), asset('CASH', '0.20')])).toBe('0.30');
    expect(sumMoney(['1234567.89', '0.11'])).toBe('1234568.00');
  });

  it('is zero for a user with no assets', () => {
    expect(computeNetWorth([])).toBe('0.00');
  });

  // Same totals as the example response in SAD 4.3.3. Note: that example lists
  // 79.26% / 2.91%, but the SAD 4.5 rounding rule gives 79.27% / 2.90%
  // (300000 / 10345000 = 2.8999%). The rule is what TC-Dash-02 tests, so we follow it.
  it('builds the SAD 4.3.3 dashboard response for the mock portfolio', () => {
    const dashboard = buildDashboard(MOCK_ASSETS, '2026-09-29T04:30:00Z');
    expect(dashboard).toEqual({
      netWorth: '10345000.00',
      currency: 'INR',
      asOf: '2026-09-29T04:30:00Z',
      hasStaleData: false,
      allocation: [
        { assetType: 'REAL_ESTATE', value: '8200000.00', percent: '79.27' },
        { assetType: 'STOCK', value: '1200000.00', percent: '11.60' },
        { assetType: 'GOLD', value: '645000.00', percent: '6.23' },
        { assetType: 'CASH', value: '300000.00', percent: '2.90' },
      ],
    });
  });
});

describe('TC-Dash-02 / PWM-F-031: allocation percentages', () => {
  it('sums to exactly 100.00 when three equal classes round to 33.33%', () => {
    const allocation = computeAllocation([
      asset('REAL_ESTATE', '100.00'),
      asset('GOLD', '100.00'),
      asset('CASH', '100.00'),
    ]);
    expect(allocation.map((s) => s.percent)).toEqual(['33.34', '33.33', '33.33']);
    expect(sumPercents(allocation)).toBe(10000);
  });

  it('gives the rounding remainder to the largest slice', () => {
    // 2/3 = 66.67 and 1/3 = 33.33 already sum to 100; force a case that rounds up.
    const allocation = computeAllocation([
      asset('STOCK', '1.00'),
      asset('GOLD', '1.00'),
      asset('CASH', '1.00'),
      asset('REAL_ESTATE', '3.00'),
    ]);
    // 16.67 * 3 + 50.00 = 100.01, so the largest slice drops to 49.99.
    expect(allocation[0]).toMatchObject({ assetType: 'REAL_ESTATE', percent: '49.99' });
    expect(sumPercents(allocation)).toBe(10000);
  });

  it('always sums to 100.00 for many random portfolios', () => {
    const types = ['REAL_ESTATE', 'STOCK', 'GOLD', 'CASH'];
    for (let i = 0; i < 500; i++) {
      const assets = types
        .filter(() => Math.random() > 0.2)
        .map((t) => asset(t, (Math.random() * 1e7).toFixed(2)));
      const allocation = computeAllocation(assets);
      if (allocation.length > 0) expect(sumPercents(allocation)).toBe(10000);
    }
  });

  it('groups several assets of the same class into one slice', () => {
    const allocation = computeAllocation([asset('GOLD', '10.00'), asset('GOLD', '30.00')]);
    expect(allocation).toEqual([{ assetType: 'GOLD', value: '40.00', percent: '100.00' }]);
  });

  it('leaves out classes with zero value and returns [] when there is nothing', () => {
    expect(computeAllocation([asset('CASH', '0.00')])).toEqual([]);
    expect(computeAllocation([])).toEqual([]);
  });
});

describe('stale price flag', () => {
  it('is true when any active asset uses a stale price', () => {
    expect(hasStaleData(MOCK_ASSETS)).toBe(false);
    expect(hasStaleData(MOCK_ASSETS_STALE)).toBe(true);
  });
});

describe('money formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR('10345000.00')).toBe('₹1,03,45,000.00');
  });

  it('shortens to lakh and crore', () => {
    expect(formatINRCompact('10345000.00')).toBe('₹1.03 Cr');
    expect(formatINRCompact('645000.00')).toBe('₹6.45 L');
    expect(formatINRCompact('300000.00')).toBe('₹3 L');
    expect(formatINRCompact('28500.00')).toBe('₹28,500');
  });

  it('rejects malformed money strings', () => {
    expect(() => toPaise('12.345')).toThrow();
    expect(() => toPaise('abc')).toThrow();
  });
});

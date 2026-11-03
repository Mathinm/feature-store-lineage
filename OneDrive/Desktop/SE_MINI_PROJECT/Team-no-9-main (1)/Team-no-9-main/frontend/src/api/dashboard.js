// Dashboard data (PWM-F-030, PWM-F-031, PWM-F-032).
//
// Uses mock data until the backend endpoints exist (see mock.js for the ?mock=
// preview states). Set VITE_USE_MOCK_API=false in frontend/.env.local and the
// real endpoints below are called instead, with no other changes. Change the
// sample data from the browser console with window.pwmMock (see mockAssets.js)
// to watch the dashboard refresh.

import { ApiError, apiFetch } from './http.js';
import { mockDelay, mockMode, requireMockSession, USE_MOCK } from './mock.js';
import { getMockAssets, MOCK_ASSETS_STALE, mockStore } from './mockAssets.js';
import { mockTrendPoints } from './mockTrend.js';
import { buildDashboard, computeNetWorth } from '../lib/dashboard.js';

if (USE_MOCK && typeof window !== 'undefined') {
  window.pwmMock = mockStore;
}

/**
 * GET /api/dashboard (SAD 4.3.3)
 * 200 {"netWorth":"10345000.00","currency":"INR","asOf":"2026-09-29T04:30:00Z",
 *      "hasStaleData":false,
 *      "allocation":[{"assetType":"REAL_ESTATE","value":"8200000.00","percent":"79.27"}, ...]}
 * 401 when not logged in.
 */
export async function fetchDashboard() {
  if (USE_MOCK) return mockDashboard();
  return apiFetch('/api/dashboard');
}

/**
 * GET /api/dashboard/trend?range=1M|6M|1Y|ALL  (PWM-F-032, TC-Dash-03)
 *
 * Contract for the backend (Sateesh):
 * - Reads net_worth_snapshots for the logged-in user only; the user id comes
 *   from the auth cookie, never from the request.
 * - One point per snapshot day, oldest first. 1M / 6M / 1Y cover the same
 *   calendar day 1, 6 or 12 months ago (clamped to month end, e.g. 31 Mar -> 28 Feb)
 *   up to today, both inclusive, in IST. ALL returns every snapshot.
 * - Today's snapshot is upserted on every asset change (SAD 4.5), so the last
 *   point matches netWorth from GET /api/dashboard.
 * - Money is a decimal string, as everywhere in the API.
 *
 * 200 {"range":"1M","currency":"INR",
 *      "points":[{"date":"2026-09-19","netWorth":"10123000.00"}, ...,
 *                {"date":"2026-10-19","netWorth":"10345000.00"}]}
 *     A user with no snapshots yet gets "points": [].
 * 400 VALIDATION_ERROR when range is not 1M, 6M, 1Y or ALL.
 * 401 when not logged in.
 */
export async function fetchTrend(range) {
  if (USE_MOCK) return mockTrend(range);
  return apiFetch(`/api/dashboard/trend?range=${encodeURIComponent(range)}`);
}

async function mockDashboard() {
  await mockDelay();
  requireMockSession();
  const mode = mockMode();
  if (mode === 'error') throw new ApiError(503, { message: 'Could not reach the server.' });
  if (mode === 'empty') return buildDashboard([]);
  return buildDashboard(mode === 'stale' ? MOCK_ASSETS_STALE : getMockAssets(), new Date().toISOString());
}

async function mockTrend(range) {
  await mockDelay();
  requireMockSession();
  const mode = mockMode();
  if (mode === 'trend-error') throw new ApiError(503, { message: 'Could not reach the server.' });
  const points =
    mode === 'empty' || mode === 'trend-empty' ? [] : mockTrendPoints(range, computeNetWorth(getMockAssets()));
  return { range, currency: 'INR', points };
}

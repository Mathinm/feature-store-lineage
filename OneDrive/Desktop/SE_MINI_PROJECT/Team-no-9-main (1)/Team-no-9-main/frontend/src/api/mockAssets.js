// Sample portfolio used until the backend asset APIs (Sateesh's issues) are merged.
// Totals match the example GET /api/dashboard response in SAD 4.3.3:
// net worth ₹1,03,45,000 = real estate 82,00,000 + stocks 12,00,000
//                          + gold 6,45,000 + cash 3,00,000.

import { notifyAssetsChanged } from './assetEvents.js';
import { ApiError } from './http.js';
import { mockCalls, mockDelay, mockMode, recordMockCall, requireMockSession } from './mock.js';
import { fromPaise, toPaise } from '../lib/money.js';
import { MAX_PROPERTY_VALUE } from '../lib/validation.js';

const INITIAL_ASSETS = [
  {
    id: 'mock-re-1',
    assetType: 'REAL_ESTATE',
    name: 'Apartment, Whitefield',
    location: 'Bengaluru',
    purchaseValue: '5200000.00',
    purchaseDate: '2021-03-15',
    currentValue: '6500000.00',
    valuedAt: '2026-06-10T05:30:00Z',
  },
  {
    id: 'mock-re-2',
    assetType: 'REAL_ESTATE',
    name: 'Plot, Vijayanagar',
    location: 'Mysuru',
    purchaseValue: '1200000.00',
    purchaseDate: '2022-08-20',
    currentValue: '1700000.00',
    valuedAt: '2026-04-12T06:00:00Z',
  },
  { id: 'mock-st-1', assetType: 'STOCK', name: 'RELIANCE', currentValue: '712500.00', isStale: false },
  { id: 'mock-st-2', assetType: 'STOCK', name: 'INFY', currentValue: '487500.00', isStale: false },
  { id: 'mock-gd-1', assetType: 'GOLD', name: 'Gold coins 24K', currentValue: '420000.00', isStale: false },
  { id: 'mock-gd-2', assetType: 'GOLD', name: 'Jewellery 22K', currentValue: '225000.00', isStale: false },
  { id: 'mock-ca-1', assetType: 'CASH', name: 'Savings account', currentValue: '250000.00' },
  { id: 'mock-ca-2', assetType: 'CASH', name: 'Wallet', currentValue: '50000.00' },
  // Deleted assets must not count toward net worth (TC-Dash-01).
  { id: 'mock-ca-3', assetType: 'CASH', name: 'Closed account', currentValue: '99999.00', deletedAt: '2026-10-01T00:00:00Z' },
];

// Earlier valuations of each property (the valuations table). The latest row
// matches the property's currentValue and valuedAt.
const INITIAL_HISTORY = [
  { id: 'val-re1-1', assetId: 'mock-re-1', value: '5200000.00', source: 'MANUAL', valuedAt: '2021-03-15T06:30:00Z' },
  { id: 'val-re1-2', assetId: 'mock-re-1', value: '5850000.00', source: 'MANUAL', valuedAt: '2023-07-01T06:30:00Z' },
  { id: 'val-re1-3', assetId: 'mock-re-1', value: '6500000.00', source: 'MANUAL', valuedAt: '2026-06-10T05:30:00Z' },
  { id: 'val-re2-1', assetId: 'mock-re-2', value: '1200000.00', source: 'MANUAL', valuedAt: '2022-08-20T06:00:00Z' },
  { id: 'val-re2-2', assetId: 'mock-re-2', value: '1450000.00', source: 'MANUAL', valuedAt: '2024-11-05T06:00:00Z' },
  { id: 'val-re2-3', assetId: 'mock-re-2', value: '1700000.00', source: 'MANUAL', valuedAt: '2026-04-12T06:00:00Z' },
];

// An asset that exists but belongs to another account. The mock holds no data
// for it at all: like the real API, it only ever answers 403.
const OTHER_USERS_ASSET_IDS = new Set(['mock-re-other-user']);

export const MOCK_ASSETS = INITIAL_ASSETS;

/** Same portfolio but with one stock price flagged stale, to preview the stale badge. */
export const MOCK_ASSETS_STALE = MOCK_ASSETS.map((a) =>
  a.id === 'mock-st-2' ? { ...a, isStale: true } : a,
);

// A small in-memory store so the refresh behaviour can be demonstrated and
// tested before the real asset forms exist. From the browser console:
//   pwmMock.setValue('mock-ca-1', '1000000.00')   change a value
//   pwmMock.add('GOLD', '500000.00')              add a holding
//   pwmMock.remove('mock-re-2')                   delete a holding
//   pwmMock.reset()                               back to the sample data
//   pwmMock.calls                                 requests made to the mock API
let store = INITIAL_ASSETS.map((a) => ({ ...a }));
let history = INITIAL_HISTORY.map((v) => ({ ...v }));

export function getMockAssets() {
  return store;
}

export const mockStore = {
  setValue(id, currentValue) {
    store = store.map((a) => (a.id === id ? { ...a, currentValue } : a));
    notifyAssetsChanged();
  },
  add(assetType, currentValue) {
    store = [...store, { id: `mock-${Date.now()}`, assetType, name: 'New asset', currentValue }];
    notifyAssetsChanged();
  },
  remove(id) {
    store = store.map((a) => (a.id === id ? { ...a, deletedAt: new Date().toISOString() } : a));
    notifyAssetsChanged();
  },
  reset() {
    store = INITIAL_ASSETS.map((a) => ({ ...a }));
    history = INITIAL_HISTORY.map((v) => ({ ...v }));
    notifyAssetsChanged();
  },
  get calls() {
    return mockCalls;
  },
};

// ---------------------------------------------------------------------------
// Mock endpoints behind src/api/assets.js (the real contract is documented there).

const unavailable = () => new ApiError(503, { message: 'Could not reach the server.' });
const forbidden = () => new ApiError(403, { code: 'FORBIDDEN', message: "You can't access this asset." });

/** The caller's own, non-deleted asset, or the 403 / 404 the API would give. */
function ownAsset(id) {
  if (OTHER_USERS_ASSET_IDS.has(id)) throw forbidden();
  const asset = store.find((a) => a.id === id && !a.deletedAt);
  if (!asset) throw new ApiError(404, { code: 'NOT_FOUND', message: 'Asset not found.' });
  return asset;
}

export async function mockListAssets(type) {
  recordMockCall('GET', `/api/assets?type=${type}`);
  await mockDelay();
  requireMockSession();
  const mode = mockMode();
  if (mode === 'error') throw unavailable();
  const items = mode === 'empty' ? [] : store.filter((a) => !a.deletedAt && (!type || a.assetType === type));
  return { items: items.map((a) => ({ ...a })), page: 1, limit: 200, total: items.length };
}

export async function mockGetAsset(id) {
  recordMockCall('GET', `/api/assets/${id}`);
  await mockDelay();
  requireMockSession();
  return { ...ownAsset(id) };
}

export async function mockUpdateValuation(id, value) {
  recordMockCall('PUT', `/api/assets/${id}/valuation`, { value });
  await mockDelay();
  requireMockSession();
  const mode = mockMode();
  if (mode === 'forbidden') throw forbidden();
  const asset = ownAsset(id);
  if (asset.assetType !== 'REAL_ESTATE' && asset.assetType !== 'CASH') {
    throw new ApiError(422, { code: 'MARKET_VALUED', message: 'This asset is valued from market prices.' });
  }

  // The API's schema validation: a plain decimal string, 0 or more, 2 decimals at most.
  const valid = typeof value === 'string' && /^\d+(\.\d{1,2})?$/.test(value) && toPaise(value) <= toPaise(MAX_PROPERTY_VALUE);
  if (mode === 'invalid' || !valid) {
    throw new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Check the highlighted field.',
      fields: [{ field: 'value', message: 'must be an amount from 0 to 10000000000.00 with at most 2 decimals' }],
    });
  }

  const amount = fromPaise(toPaise(value)); // canonical form, e.g. "8500000.00"
  const valuedAt = new Date().toISOString();
  store = store.map((a) => (a.id === id ? { ...a, currentValue: amount, valuedAt } : a));
  // A new MANUAL row; earlier rows are never changed.
  history = [...history, { id: `val-${Date.now()}`, assetId: id, value: amount, source: 'MANUAL', valuedAt }];
  return { ...store.find((a) => a.id === id) };
}

export async function mockValuationHistory({ assetId, from, to }) {
  recordMockCall('GET', `/api/valuations/history?assetId=${assetId}`);
  await mockDelay();
  requireMockSession();
  ownAsset(assetId);
  const items = history
    .filter((v) => v.assetId === assetId)
    .filter((v) => (!from || v.valuedAt.slice(0, 10) >= from) && (!to || v.valuedAt.slice(0, 10) <= to))
    .sort((a, b) => (a.valuedAt < b.valuedAt ? 1 : -1))
    .map((v) => ({ ...v }));
  return { items, page: 1, limit: 200, total: items.length };
}

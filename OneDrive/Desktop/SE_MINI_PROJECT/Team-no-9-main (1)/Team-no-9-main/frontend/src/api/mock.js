// Helpers shared by the mock API branches. Mock data is on by default until the
// backend endpoints exist; set VITE_USE_MOCK_API=false to use the real API.
//
// Preview other states with ?mock=... in the URL (before any #):
//   ?mock=stale        one stock price flagged stale
//   ?mock=empty        a new user with no assets and no history
//   ?mock=error        the dashboard request fails
//   ?mock=trend-empty  the dashboard loads, but there is no net-worth history yet
//   ?mock=trend-error  the dashboard loads, but the trend request fails
//   ?mock=unauth       every request answers 401, as with an expired session
//   ?mock=forbidden    saving a valuation answers 403 (not your asset)
//   ?mock=invalid      saving a valuation answers 400 with a server field error
// The asset at #/assets/mock-re-other-user/... belongs to "another user" and
// always answers 403.

import { ApiError } from './http.js';

export const USE_MOCK = import.meta.env.VITE_USE_MOCK_API !== 'false';

export function mockMode() {
  return new URLSearchParams(window.location.search).get('mock');
}

export function mockDelay(ms = 300) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Requests made to the mock API, newest last; tests read it via window.pwmMock.calls. */
export const mockCalls = [];

export function recordMockCall(method, path, body) {
  mockCalls.push({ method, path, body });
}

let sessionsRevoked = false;

/** What the auth middleware does for a missing, expired or revoked session (SAD 3.9). */
export function requireMockSession() {
  if (sessionsRevoked || mockMode() === 'unauth') {
    throw new ApiError(401, { code: 'UNAUTHENTICATED', message: 'Your session has expired.' });
  }
}

/** A password reset sets users.token_valid_after, which ends every existing session. */
export function revokeMockSessions() {
  sessionsRevoked = true;
}

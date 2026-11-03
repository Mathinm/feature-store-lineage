// Password reset (PWM-F-003, TC-Auth-03; SAD 3.9, 4.2.3).
// Uses the mock in mockAuth.js until the auth API exists (Sateesh's issues).
//
// Contract for the backend. Both endpoints are public (no auth cookie needed)
// and rate limited like the rest of /api/auth/*.

import { apiFetch } from './http.js';
import { USE_MOCK } from './mock.js';
import { mockForgotPassword, mockResetPassword } from './mockAuth.js';

/**
 * POST /api/auth/forgot-password   body {"email":"user@example.com"}
 * 202, empty body, whether or not an account exists, after the same amount of
 *     work either way, so neither the reply nor its timing reveals accounts.
 *     For a real account: create a random token (at least 32 bytes), store only
 *     its SHA-256 hash in password_reset_tokens with expires_at = now + 30 min,
 *     and queue an email with the link
 *       <app origin>/#/reset-password?token=<token>
 *     Encode the token as hex or base64url. The reset page reads it with
 *     URLSearchParams, which turns "+" into a space, so a plain base64 token
 *     would break unless it were percent-encoded.
 *     The token sits in the URL hash, so it never reaches server logs or the
 *     Referer header.
 * 400 VALIDATION_ERROR with fields [{"field":"email",...}] for a malformed email.
 * 429 when rate limited (Retry-After set).
 */
export async function requestPasswordReset(email) {
  if (USE_MOCK) return mockForgotPassword(email);
  return apiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } });
}

/**
 * POST /api/auth/reset-password   body {"token":"…","newPassword":"…"}
 * 204 on success: the password hash is replaced (argon2id), the token's used_at
 *     is set, and users.token_valid_after = now, so every existing session
 *     (on every device) gets 401 from then on.
 * 400 with one of these error codes when the link can't be used (no field list):
 *       RESET_TOKEN_INVALID   no such token
 *       RESET_TOKEN_EXPIRED   older than 30 minutes
 *       RESET_TOKEN_USED      already used once
 * 400 VALIDATION_ERROR with fields [{"field":"newPassword","message":"…"}] when the
 *     password breaks the policy (10-128 characters, a letter and a digit, not a
 *     common password). The token stays unused, so the user can try again.
 * 429 when rate limited.
 */
export async function resetPassword(token, newPassword) {
  if (USE_MOCK) return mockResetPassword(token, newPassword);
  return apiFetch('/api/auth/reset-password', { method: 'POST', body: { token, newPassword } });
}

// Mock password-reset endpoints, used until the auth API exists (contract in auth.js).
//
// The server keeps only each token's SHA-256 hash, with expires_at and used_at
// (password_reset_tokens). The mock keeps the same state per token:
//   #/reset-password?token=mock-valid    works once, for 30 minutes after the page loads
//   #/reset-password?token=mock-expired  issued 31 minutes ago
//   #/reset-password?token=mock-used     already used
//   any other token                      invalid
// Forgot password for user@example.com issues a fresh token and prints its link to
// the browser console, standing in for the email; other addresses get nothing.
// Both answer 202 after the same delay.

import { ApiError } from './http.js';
import { mockDelay, recordMockCall, revokeMockSessions } from './mock.js';
import { validateEmail, validatePassword } from '../lib/validation.js';

const MINUTE = 60_000;
const TOKEN_LIFETIME = 30 * MINUTE;
const loadedAt = Date.now();

const tokens = new Map([
  ['mock-valid', { expiresAt: loadedAt + TOKEN_LIFETIME, usedAt: null }],
  ['mock-expired', { expiresAt: loadedAt - MINUTE, usedAt: null }],
  ['mock-used', { expiresAt: loadedAt + 20 * MINUTE, usedAt: loadedAt - 5 * MINUTE }],
]);

const ACCOUNTS = new Set(['user@example.com']);

// A few entries standing in for the server's common-password list.
const COMMON_PASSWORDS = new Set(['password123', 'password1234', 'qwerty12345', 'iloveyou123', 'abc1234567']);

export async function mockForgotPassword(email) {
  recordMockCall('POST', '/api/auth/forgot-password', { email });
  await mockDelay(400);
  const problem = validateEmail(email);
  if (problem) {
    throw new ApiError(400, { code: 'VALIDATION_ERROR', message: problem, fields: [{ field: 'email', message: problem }] });
  }
  if (ACCOUNTS.has(email.trim().toLowerCase())) {
    // randomUUID needs a secure context (localhost is one); fall back when served over plain http.
    const token = `mock-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    tokens.set(token, { expiresAt: Date.now() + TOKEN_LIFETIME, usedAt: null });
    console.info(`[mock email] Password reset link: ${window.location.origin}/#/reset-password?token=${token}`);
  }
  return null; // 202
}

export async function mockResetPassword(token, newPassword) {
  recordMockCall('POST', '/api/auth/reset-password', { token }); // never record the password
  await mockDelay();
  const entry = tokens.get(token);
  if (!entry) throw new ApiError(400, { code: 'RESET_TOKEN_INVALID', message: 'This reset link is not valid.' });
  if (entry.usedAt) throw new ApiError(400, { code: 'RESET_TOKEN_USED', message: 'This reset link has already been used.' });
  if (Date.now() > entry.expiresAt) {
    throw new ApiError(400, { code: 'RESET_TOKEN_EXPIRED', message: 'This reset link has expired.' });
  }

  const problem =
    validatePassword(newPassword) ??
    (COMMON_PASSWORDS.has(newPassword.toLowerCase()) ? 'This password is too common. Choose another one.' : null);
  if (problem) {
    // The token stays unused, so the user can try again with a better password.
    throw new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Check the highlighted field.',
      fields: [{ field: 'newPassword', message: problem }],
    });
  }

  entry.usedAt = Date.now();
  revokeMockSessions();
  return null; // 204
}

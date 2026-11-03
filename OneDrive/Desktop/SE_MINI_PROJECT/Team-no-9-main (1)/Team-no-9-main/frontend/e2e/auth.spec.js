// Password reset (PWM-F-003, #32; TC-Auth-03), using the mock auth API.
// Mock tokens: mock-valid (works once), mock-expired (31 minutes old), mock-used.
import { expect, test } from '@playwright/test';
import { expectFitsScreen, goToHash, WIDTHS } from './helpers.js';

const SAME_MESSAGE = "If an account exists for that email, we've sent a reset link.";

async function submitNewPassword(page, password, confirmation = password) {
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(confirmation);
  await page.getByRole('button', { name: 'Reset password' }).click();
}

test('the login page links to "Forgot password?"', async ({ page }) => {
  await page.goto('/#/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('forgot password checks the email format before sending', async ({ page }) => {
  await page.goto('/#/forgot-password');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.locator('#forgot-email-error')).toHaveText('Enter a valid email address, like name@example.com.');
  expect(await page.evaluate(() => window.pwmMock.calls.filter((c) => c.path === '/api/auth/forgot-password').length)).toBe(0);
});

test('TC-Auth-03: forgot password shows the same message for any email', async ({ page }) => {
  const replies = [];
  for (const email of ['user@example.com', 'nobody@example.com']) {
    // Start from the login page each time so the form is fresh.
    await page.goto('/#/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    // The login page has an "Email" field too; wait for the reset form first.
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    const reply = page.getByTestId('reset-requested');
    await expect(reply).toContainText(SAME_MESSAGE);
    replies.push(await reply.textContent());
  }
  // Word for word the same, so the page never reveals whether an account exists.
  expect(replies[0]).toBe(replies[1]);
});

test('TC-Auth-03: a valid link resets the password once, then old sessions and the reused link are rejected', async ({ page }) => {
  await page.goto('/#/reset-password?token=mock-valid');
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

  // Password policy, checked before anything is sent.
  const passwordError = page.locator('#new-password-error');
  await submitNewPassword(page, 'short1');
  await expect(passwordError).toHaveText('Use at least 10 characters.');
  await submitNewPassword(page, 'onlyletters');
  await expect(passwordError).toHaveText('Include at least one number.');
  await submitNewPassword(page, '1234567890');
  await expect(passwordError).toHaveText('Include at least one letter.');
  await submitNewPassword(page, 'GreenTea2026', 'GreenTea2025');
  await expect(page.locator('#confirm-password-error')).toHaveText("The passwords don't match.");
  expect(await page.evaluate(() => window.pwmMock.calls.filter((c) => c.path === '/api/auth/reset-password').length)).toBe(0);

  // First use within 30 minutes succeeds.
  await submitNewPassword(page, 'GreenTea2026');
  await expect(page.getByRole('heading', { name: 'Your password has been reset' })).toBeVisible();
  await expect(page.getByTestId('reset-done')).toContainText('signed out, on all devices');

  // Old sessions stop working: the dashboard now asks to log in again.
  await goToHash(page, '#/');
  await expect(page.getByTestId('session-expired')).toContainText('Please log in again');
  await expect(page.getByTestId('net-worth-value')).toHaveCount(0);

  // Reusing the same link is rejected.
  await goToHash(page, '#/reset-password?token=mock-valid');
  await submitNewPassword(page, 'AnotherOne2026');
  await expect(page.getByRole('heading', { name: 'This reset link has already been used' })).toBeVisible();
  await page.getByRole('link', { name: 'Request a new link' }).click();
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
});

test('TC-Auth-03: an expired link is rejected', async ({ page }) => {
  await page.goto('/#/reset-password?token=mock-expired');
  await submitNewPassword(page, 'GreenTea2026');
  const problem = page.getByTestId('reset-link-expired');
  await expect(page.getByRole('heading', { name: 'This reset link has expired' })).toBeVisible();
  await expect(problem).toContainText('30 minutes');
  await expect(problem.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '#/forgot-password');
});

test('an already-used link is rejected', async ({ page }) => {
  await page.goto('/#/reset-password?token=mock-used');
  await submitNewPassword(page, 'GreenTea2026');
  await expect(page.getByTestId('reset-link-used')).toBeVisible();
});

test('an invalid or missing token is rejected', async ({ page }) => {
  await page.goto('/#/reset-password?token=not-a-real-token');
  await submitNewPassword(page, 'GreenTea2026');
  await expect(page.getByRole('heading', { name: "This reset link isn't valid" })).toBeVisible();

  // No token at all: no form, straight to the invalid-link screen.
  await page.goto('/#/reset-password');
  await expect(page.getByTestId('reset-link-invalid')).toBeVisible();
  await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
});

test('a server-side policy error (common password) appears on the field and the link still works', async ({ page }) => {
  await page.goto('/#/reset-password?token=mock-valid');
  await submitNewPassword(page, 'Password1234');
  await expect(page.locator('#new-password-error')).toHaveText('This password is too common. Choose another one.');
  await submitNewPassword(page, 'GreenTea2026');
  await expect(page.getByTestId('reset-done')).toBeVisible();
});

for (const width of WIDTHS) {
  test(`login, forgot and reset screens fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    await page.goto('/#/login');
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
    await expectFitsScreen(page);

    await page.goto('/#/forgot-password');
    await page.getByLabel('Email').fill('nope');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.locator('#forgot-email-error')).toBeVisible();
    await expectFitsScreen(page);
    await page.getByLabel('Email').fill('user@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByTestId('reset-requested')).toBeVisible();
    await expectFitsScreen(page);

    await page.goto('/#/reset-password?token=mock-valid');
    await submitNewPassword(page, 'short', 'different');
    await expect(page.locator('#new-password-error')).toBeVisible();
    await expectFitsScreen(page);
    await submitNewPassword(page, 'GreenTea2026');
    await expect(page.getByTestId('reset-done')).toBeVisible();
    await expectFitsScreen(page);

    await page.goto('/#/reset-password?token=mock-expired');
    await submitNewPassword(page, 'GreenTea2026');
    await expect(page.getByTestId('reset-link-expired')).toBeVisible();
    await expectFitsScreen(page);
  });
}

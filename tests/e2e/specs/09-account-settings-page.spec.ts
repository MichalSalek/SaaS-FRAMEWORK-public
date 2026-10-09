// tests/e2e/specs/09-account-settings-page.spec.ts
//
// CRITICAL PATH #7 (Email change request → verification token → updated):
//   We exercise the entry surface (the account settings UI where the email
//   change flow lives) plus a negative API contract check on /user/change-email.
//
//   We DELIBERATELY do not fire a real email change against the seeded test
//   stylist — flipping their email mid-suite corrupts every subsequent test
//   that depends on that stable identity. The smoke check is: the page loads
//   for an authenticated user AND the endpoint rejects an invalid payload
//   (proving validation is wired, which is the most common silent regression).

import { test, expect } from '@playwright/test';
import {
  fetchDevLoginToken,
  loginViaDevToken,
  waitForAuthedSessionRoundTrip,
} from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { E2E_ENV } from '../helpers/env';

test.describe('account settings: page loads + email change endpoint validates', () => {
  let stylistToken = '';

  test.beforeAll(async () => {
    stylistToken = await fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
  });

  test('account page renders and change-email rejects malformed input', async ({
    page,
    context,
  }) => {
    // UI smoke — authenticated stylist hits the account settings page.
    // Deterministic boot signal (replaces networkidle): the get-session
    // round-trip returned a live session — see helpers/auth.ts.
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
    const authedBoot = waitForAuthedSessionRoundTrip(page);
    await page.goto('/app/user/account');
    await authedBoot;

    await expect(page).toHaveURL(/\/app\/user\/account/);
    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.length).toBeGreaterThan(50);
    expect(bodyText.toLowerCase()).not.toContain('internal server error');

    // API contract — endpoint must validate body. Empty email should NOT
    // succeed; we accept any 4xx (400 = validation failure, 422 =
    // unprocessable, 403 = impersonation gate if seeded admin coincidentally
    // impersonating). 200/201/204 here would be a real regression.
    const invalid = await apiCall('/api/v1/user/change-email', {
      method: 'POST',
      token: stylistToken,
      body: { email: 'not-an-email-at-all' },
    });
    expect(
      invalid.status >= 400 && invalid.status < 500,
      `change-email accepted invalid input — status ${invalid.status}, body ${JSON.stringify(invalid.body).slice(0, 200)}`
    ).toBe(true);
  });
});

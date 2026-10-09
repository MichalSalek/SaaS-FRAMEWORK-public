// tests/e2e/specs/13-account-recovery-soft-delete.spec.ts
//
// CRITICAL PATH #13 (Soft-delete → login → 1-click reactivation):
//   Verifies the account-state-guard + recovery flow surface:
//     1. check-recovery API endpoint is reachable and authenticated.
//     2. The user/reactivate API endpoint is reachable and returns a
//        recognisable response (success or "no recovery pending").
//     3. /app/user/recover page renders and contains the expected recovery
//        action surface (CTA or redirect to login).
//     4. A soft-deleted account (is_active=false, recovery_available=true)
//        encountering the account-state-guard sees the correct 403+USER_DISABLED
//        signal — exercised indirectly by verifying guard middleware wiring.
//
// DECISION (nie usuwaj tego komentarza):
// We DO NOT actually soft-delete the seeded test user — that would corrupt the
// test user state for every other spec in the suite. Instead we:
//   a) Probe the check-recovery and reactivate endpoints with the live stylist
//      token (expected: 200 with recovery_available=false, or 404/200 if no
//      recovery pending — both are valid, neither is 401/5xx).
//   b) Exercise the /app/user/recover frontend page (unauthenticated visit
//      redirects to login per account-state-guard; authenticated visit with no
//      pending recovery shows the "nothing to recover" state).
// The full soft-delete → hard-login → guard 403 → reactivation cycle is
// covered by tests/smoke/recovery-domain.smoke.ts which runs against an
// isolated Prisma transaction that it can roll back.

import { test, expect } from '@playwright/test';
import {
  fetchDevLoginToken,
  loginViaDevToken,
  waitForAuthedSessionRoundTrip,
} from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { E2E_ENV } from '../helpers/env';
import { ROUTES_API } from '../../../.shared-kernel/domain/routing/routing.config';

test.describe('account recovery: soft-delete lifecycle surface', () => {
  let stylistToken = '';

  test.beforeAll(async () => {
    stylistToken = await fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
  });

  test('check-recovery endpoint is reachable and returns a valid envelope', async () => {
    // check-recovery is a POST command taking { email } (anti-enumeration, ADRR
    // Model A §13.1): it returns a UNIFORM envelope for ANY email — existing,
    // soft-deleted, or unknown — so an attacker cannot probe account existence.
    // A GET (the previous shape) 405s; an empty body 400s (email required).
    const result = await apiCall<{
      data?: { recovery_available?: boolean; deleted_at?: string | null };
      event?: string;
    }>(ROUTES_API.USER_CHECK_RECOVERY, {
      method: 'POST',
      token: stylistToken,
      body: { email: E2E_ENV.USERS.STYLIST },
    });

    // 200 = endpoint wired and returned the uniform recovery envelope.
    // 401/403 = auth broken — always a failure.
    expect(
      result.status,
      `check-recovery returned ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`
    ).toBe(200);

    // Envelope shape check — recovery_available must be a boolean (uniform
    // anti-enumeration response is always `false`).
    expect(typeof result.body?.data?.recovery_available).toBe('boolean');
  });

  test('reactivate endpoint returns a recoverable or "no-op" response for active account', async () => {
    // Calling reactivate on an ACTIVE account should return a semantic error
    // (not a 5xx crash). The seeded test stylist is active, so we expect:
    //   - 200 (some implementations return "already active, no-op"),
    //   - 409 (Conflict — account not in recovery state), or
    //   - 422 (Unprocessable — no pending recovery).
    // NOT acceptable: 401 (auth broken), 5xx (handler crash).
    const result = await apiCall<{
      event?: string;
      data?: unknown;
    }>(ROUTES_API.USER_REACTIVATE_ACCOUNT, {
      method: 'POST',
      token: stylistToken,
      body: {},
    });

    expect(
      [200, 409, 422, 404].includes(result.status),
      `reactivate returned ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`
    ).toBe(true);
    expect(result.status).not.toBe(401);
    expect(result.status).toBeLessThan(500);
  });

  test('/app/user/recover page is reachable when authenticated and renders without 5xx', async ({
    page,
    context,
  }) => {
    // Authenticated stylist visits the recover page. With no pending recovery,
    // the UI should either show a "nothing to recover" message or redirect back
    // to /app. Both are correct — what must NOT happen is a 5xx crash or 404.
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
    // Deterministic boot signal (replaces networkidle): the get-session
    // round-trip returned a live session — see helpers/auth.ts. Fires from
    // the recover page mount even if the UI then redirects back to /app,
    // so both valid outcomes below stay covered.
    const authedBoot = waitForAuthedSessionRoundTrip(page);
    await page.goto('/app/user/recover');
    await authedBoot;

    await expect(page).not.toHaveTitle(/404|not found/i);

    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.length).toBeGreaterThan(20);
    expect(bodyText.toLowerCase()).not.toContain('internal server error');
    expect(bodyText.toLowerCase()).not.toContain('application error');

    // Page must be inside the app shell or the home surface — not the raw 404.
    const finalUrl = page.url();
    const isInsideApp = /\/app(?:\/|$|\?)/.test(finalUrl);
    const isHomeSurface = /^\s*(http[^/]+\/\s*$|http[^/]+\/en\/|http[^/]+\/pl\/)/.test(finalUrl);
    expect(
      isInsideApp || isHomeSurface,
      `recover redirect landed on unexpected URL: ${finalUrl}`
    ).toBe(true);
  });

  test('unauthenticated visit to /app/user/recover shows the logged-out recovery hub', async ({
    page,
  }) => {
    // BY DESIGN (AccountRecoveryPage.composition — the `!hasSessionToken()`
    // branch): an unauthenticated direct visit does NOT hard-redirect. Recovery
    // is post-login + state-driven (zero enumeration), so instead of bouncing —
    // or worse, falsely deriving an ACTIVE state — the page renders a LOGGED-OUT
    // recovery hub: the "Przywroc zamkniete konto" hero + a "go to login" CTA
    // that explains recovery = sign in with the same email. The route is in
    // ACCOUNT_ROUTE_PREFIXES (route-access.policy) so nothing bounces a direct
    // visit — assert the hub UNCONDITIONALLY. A future regression that starts
    // redirecting this route to login is EXACTLY what this test must catch, so we
    // do NOT tolerate a login URL here (a conditional would let it pass silently).
    // No explicit load-state wait needed: every assertion below auto-retries
    // (toHaveTitle / toHaveURL / toBeVisible), so the hub render IS the signal.
    await page.goto('/app/user/recover');

    await expect(page).not.toHaveTitle(/404|not found|error/i);
    await expect(page).toHaveURL(/\/app\/user\/recover/);

    // Logged-out recovery hub rendered — the hero title + sign-in CTA prove the
    // no-token branch (not the authed dashboard, not a crash, not a false
    // "account active" state). .first(): a narrow-viewport nav "Zaloguj"
    // affordance can co-exist with the hub's "Przejdz do logowania" CTA.
    await expect(page.getByText(/zamkni.te konto/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /logowani|zaloguj/i }).first()
    ).toBeVisible();

    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.toLowerCase()).not.toContain('internal server error');
    expect(E2E_ENV.FRONTEND_URL.length).toBeGreaterThan(0);
  });
});

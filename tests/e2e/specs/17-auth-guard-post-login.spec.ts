// tests/e2e/specs/17-auth-guard-post-login.spec.ts
//
// Regression guard: "reactive-guard bounce after dev-login". After a Quick Login tile click,
// `devLogin_IO` stores the token in `localStorage["authorization"]`; `successCallback` must call
// `refetchSession()` BEFORE `router.push`, otherwise the AuthContext idle-guard still sees
// `session:null` while the token is in storage and bounces the user back to /user/login.
//
// Spec 16 injects the token BEFORE the app boots. This spec drives the real UI (tile click, then
// router.push) so the token arrives AFTER the SPA started, and asserts the user stays on /app.
//
// The ?authCode bridge variant (real magic-link verify) is not covered here.
//
// DECISION: loginViaUI is preferred over loginViaDevToken + injectSessionToken here. The tile click runs
// the real React handler (devLogin_IO -> localStorage.setItem -> refetchSession -> router.push), the
// exact sequence the fix patched; pre-injecting the token bypasses it and would give a false green.

import { test, expect } from '@playwright/test';
import { loginViaUI, waitForAuthedSessionRoundTrip } from '../helpers/auth';
import { E2E_ENV } from '../helpers/env';

test.describe('auth-guard: reactive guard does not bounce after login (#7 regression)', () => {
  // ---------------------------------------------------------------------------
  // Case: STYLIST login via UI tile → guard must accept session, no bounce
  // ---------------------------------------------------------------------------
  test('loginViaUI stylist: stays at /app after Quick Login tile click (guard-post-login #7)', async ({
    page,
  }) => {
    // Drive the actual login UI — token lands in storage via React handler,
    // NOT via pre-inject. This reproduces the #7 race condition path.
    //
    // Deterministic post-login signal (replaces networkidle): the #7 fix is
    // literally "refetchSession() BEFORE router.push", so a session-BEARING
    // get-session round-trip MUST happen during the UI login. The helper
    // ignores the anonymous get-session fired on the login page itself and
    // resolves only on the authed one; in the broken state (stale atom →
    // bounce) it never fires and this wait times out loudly.
    const authedLogin = waitForAuthedSessionRoundTrip(page);
    await loginViaUI(page, E2E_ENV.USERS.STYLIST);
    await authedLogin;

    // CORE REGRESSION ASSERTION: guard must NOT have bounced us back to login.
    // In the broken state the guard sees session:null (stale atom) and redirects;
    // in the fixed state refetchSession() updated the atom before router.push.
    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });

    // Must be somewhere under /app (stylist lands on gallery or dashboard).
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });

  // ---------------------------------------------------------------------------
  // Case: CLIENT login via UI tile
  // ---------------------------------------------------------------------------
  test('loginViaUI client: stays at /app after Quick Login tile click (guard-post-login #7)', async ({
    page,
  }) => {
    // Deterministic post-login signal (replaces networkidle) — see stylist case.
    const authedLogin = waitForAuthedSessionRoundTrip(page);
    await loginViaUI(page, E2E_ENV.USERS.CLIENT);
    await authedLogin;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });

  // ---------------------------------------------------------------------------
  // Case: ADMIN login via UI tile
  // ---------------------------------------------------------------------------
  test('loginViaUI admin: stays at /app after Quick Login tile click (guard-post-login #7)', async ({
    page,
  }) => {
    // Deterministic post-login signal (replaces networkidle) — see stylist case.
    const authedLogin = waitForAuthedSessionRoundTrip(page);
    await loginViaUI(page, E2E_ENV.USERS.ADMIN);
    await authedLogin;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });

  // ---------------------------------------------------------------------------
  // Bonus: reload after UI login must still be authed (token persisted to storage)
  // ---------------------------------------------------------------------------
  test('loginViaUI stylist: token persists reload after UI login (storage write confirmed)', async ({
    page,
  }) => {
    // Deterministic post-login signal (replaces networkidle) — see first case.
    const authedLogin = waitForAuthedSessionRoundTrip(page);
    await loginViaUI(page, E2E_ENV.USERS.STYLIST);
    await authedLogin;

    // Establish we are in the app before reload.
    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });

    // Reload — verifies the token was written to localStorage (not just in
    // memory): the fresh boot must again produce a session-BEARING get-session.
    const authedReload = waitForAuthedSessionRoundTrip(page);
    await page.reload();
    await authedReload;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });
});

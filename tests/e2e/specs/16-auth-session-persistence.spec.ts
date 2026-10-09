// tests/e2e/specs/16-auth-session-persistence.spec.ts
//
// FAZA 5.3 — Auth-persistence regression spec.
//
// PURPOSE: Guard against future regressions in session-transport wiring.
//   The canonical failure mode (r28 "half-migration") was: bearer token
//   injected into the dead key `better-auth.session_token` — frontend reads
//   `localStorage[CUSTOM_HEADERS.authorization]` ("authorization"), so the app
//   booted with no token and bounced straight to /user/login on every navigation.
//   After the fix, the token survives a full page reload.
//
// SCOPE (3 roles × 2 cases = 6 assertions + 1 negative control per role = 9 tests):
//   Case A — "login persists reload": inject valid dev-login token → goto /app →
//     assert AUTHED (not bounced to /user/login) → reload() → assert STILL AUTHED.
//   Case B — "no token = bounce": no injection → goto /app → assert bounce to login.
//
// BECOME-USER CASE: skipped — spec 08 already covers the become-user round-trip
//   at the API level; the browser-side localStorage flag requires additional React
//   client-side orchestration not worth duplicating here. See tests/e2e/README.md.
//
// DECISION (nie usuwaj tego komentarza):
//   All three role tests share the same Case B ("no token = bounce") structure.
//   We assert the URL ends up on /user/login — specifically checking that /app
//   itself does NOT appear in the final URL (the auth-guard's UNAUTHORIZED target
//   is ROUTES_FRONT.APP, but when the token is absent the app immediately redirects
//   away; matching /user/login is the correct post-redirect landing check).
//   The same negative pattern holds for all three roles because the /app root
//   guard fires BEFORE any role-specific routing.

import { test, expect } from '@playwright/test';
import {
  fetchDevLoginToken,
  injectSessionToken,
  waitForAuthedSessionRoundTrip,
} from '../helpers/auth';
import { E2E_ENV } from '../helpers/env';

// ---------------------------------------------------------------------------
// STYLIST role
// ---------------------------------------------------------------------------
test.describe('auth-persistence: stylist', () => {
  test('Case A — valid token: /app stays authed after reload', async ({
    page,
    context,
  }) => {
    const token = await fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
    await injectSessionToken(context, token);

    // Deterministic boot signal (replaces networkidle): the get-session
    // round-trip must come back WITH a session — the exact wiring this spec
    // guards (r28: token in a dead key ⇒ no session ⇒ this wait times out).
    const authedBoot = waitForAuthedSessionRoundTrip(page);
    await page.goto('/app');
    await authedBoot;

    // Assert we are NOT on the login page — the session was accepted.
    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    // The URL must be somewhere under /app (stylist lands on gallery / dashboard).
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);

    // Core regression check: token must survive a full page reload.
    const authedReload = waitForAuthedSessionRoundTrip(page);
    await page.reload();
    await authedReload;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });

  test('Case B — no token: /app bounces to /user/login', async ({ page }) => {
    // No injectSessionToken — empty storage, no auth. toHaveURL auto-retries
    // (10s), so no explicit load-state wait is needed for the redirect.
    await page.goto('/app');

    await expect(page).toHaveURL(/\/user\/login/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// CLIENT role
// ---------------------------------------------------------------------------
test.describe('auth-persistence: client', () => {
  test('Case A — valid token: /app stays authed after reload', async ({
    page,
    context,
  }) => {
    const token = await fetchDevLoginToken(E2E_ENV.USERS.CLIENT);
    await injectSessionToken(context, token);

    // Deterministic boot signal (replaces networkidle) — see stylist Case A.
    const authedBoot = waitForAuthedSessionRoundTrip(page);
    await page.goto('/app');
    await authedBoot;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);

    // Reload persistence check.
    const authedReload = waitForAuthedSessionRoundTrip(page);
    await page.reload();
    await authedReload;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });

  test('Case B — no token: /app bounces to /user/login', async ({ page }) => {
    await page.goto('/app');

    await expect(page).toHaveURL(/\/user\/login/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// ADMIN role
// ---------------------------------------------------------------------------
test.describe('auth-persistence: admin', () => {
  test('Case A — valid token: /app/admin stays authed after reload', async ({
    page,
    context,
  }) => {
    const token = await fetchDevLoginToken(E2E_ENV.USERS.ADMIN);
    await injectSessionToken(context, token);

    // Admin-specific authed route — exercises the admin guard path in addition
    // to the shared /app auth guard. Deterministic boot signal (replaces
    // networkidle): AuthContext fires get-session on every page load, also
    // inside the AdminLayout shell.
    const authedBoot = waitForAuthedSessionRoundTrip(page);
    await page.goto('/app/admin');
    await authedBoot;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);

    // Reload persistence check.
    const authedReload = waitForAuthedSessionRoundTrip(page);
    await page.reload();
    await authedReload;

    await expect(page).not.toHaveURL(/\/user\/login/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);
  });

  test('Case B — no token: /app bounces to /user/login', async ({ page }) => {
    await page.goto('/app');

    await expect(page).toHaveURL(/\/user\/login/, { timeout: 10_000 });
  });
});

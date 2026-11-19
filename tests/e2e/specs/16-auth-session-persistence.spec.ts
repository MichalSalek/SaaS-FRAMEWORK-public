// tests/e2e/specs/16-auth-session-persistence.spec.ts
//
// Auth-persistence regression spec for the session-transport wiring. Failure mode: a bearer token
// injected into the dead key `better-auth.session_token` while the frontend reads
// `localStorage[CUSTOM_HEADERS.authorization]`, so the app bounced to /user/login on every navigation.
//
// Per role: Case A injects a valid dev-login token, goto /app, asserts AUTHED, reload(), asserts STILL
// AUTHED. Case B injects nothing and asserts the bounce to login. Become-user is skipped: spec 08
// covers it at API level (see tests/e2e/README.md).
//
// DECISION: all three role tests share the "no token = bounce" structure. They assert the URL ends on
// /user/login and that /app is NOT in the final URL (the guard's UNAUTHORIZED target is
// ROUTES_FRONT.APP, but without a token the app redirects away at once). The pattern is identical for
// all roles because the /app root guard fires BEFORE any role-specific routing.

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

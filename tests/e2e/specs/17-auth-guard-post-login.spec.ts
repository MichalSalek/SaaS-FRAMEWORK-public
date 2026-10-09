// tests/e2e/specs/17-auth-guard-post-login.spec.ts
//
// Regression guard for #7 — "reactive-guard bounce after dev-login".
//
// THE BUG (fixed in R2-A):
//   After clicking a Quick Login tile, `devLogin_IO` stores the bearer token in
//   `localStorage["authorization"]` and fires `successCallback`.  The callback
//   called `router.push(postLoginTarget)` WITHOUT first calling `refetchSession()`.
//   The idle-guard in AuthContext observed `session:null` (the useSession atom had
//   not been updated yet) while the token was already present in storage, and
//   immediately bounced the freshly-logged-in user back to /user/login.
//   Fix: `refetchSession()` called BEFORE `router.push` — atom updated, guard
//   sees a live session, no bounce.
//
// WHAT SPEC 16 DOES NOT COVER:
//   Spec 16 uses `injectSessionToken(context, token)` + `page.goto('/app')` — the
//   token is already in storage BEFORE the app boots, so the guard reads the atom
//   as non-null on the very first render.  That does NOT exercise the race where
//   the token arrives AFTER the SPA has already started (token set by router nav,
//   guard fires on next render).  This spec closes that gap by driving the login
//   through the actual UI (Quick Login tile → router.push), reproducing the
//   exact sequence that caused #7.
//
// APPROACH — loginViaUI (UI-driven token arrival, not pre-inject):
//   goto /user/login → click Quick Login tile → wait for router.push to /app →
//   assert stays at /app (NOT bounced to /user/login).
//   This is the minimum executable scenario that exercises guard-post-login
//   without requiring DB access or a valid ?authCode bridge code.
//
// ?authCode BRIDGE E2E — OWNER-RUNTIME NOTE:
//   The full variant-C bridge (goto /app?authCode=<valid-code>) requires a
//   valid one-time code minted by the backend after a real magic-link verify.
//   To add that coverage when a dev-mint endpoint exists:
//     1. GET a fresh session token via fetchDevLoginToken()
//     2. POST /api/auth/dev-mint-exchange-code { sessionToken } → { code }
//        (dev-only endpoint, must be added behind IS_DEVELOPMENT_ENV gate)
//     3. page.goto(`/app?authCode=${code}`)
//     4. await waitForAuthedSessionRoundTrip (registered before the goto),
//        assert NOT bounced to /user/login
//     5. assert URL matches /app (token exchanged, guard accepted the session)
//   Until that endpoint exists, the loginViaUI path below covers the key
//   "token arrives post-boot" invariant that #7 regressed.
//
// DECISION (nie usuwaj tego komentarza):
//   loginViaUI is intentionally preferred over loginViaDevToken + injectSessionToken
//   here. The Quick Login tile click triggers the real React handler
//   (devLogin_IO → localStorage.setItem → refetchSession → router.push),
//   which is the exact sequence the #7 fix patched.  Pre-injecting the token
//   bypasses that handler entirely and would give a false green.

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

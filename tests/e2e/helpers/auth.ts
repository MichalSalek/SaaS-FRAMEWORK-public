// tests/e2e/helpers/auth.ts
//
// Authentication helpers for Playwright e2e tests.
//
// Two ways to log in:
//   1. `loginViaUI(page, email)` — drives the /user/login Quick Login tiles.
//      Use when the *login UX itself* is the thing under test. Slower but
//      exercises the real React flow + redirects.
//   2. `loginViaDevToken(page, email)` — calls /api/auth/dev-login directly to
//      get a Better Auth bearer token, then injects it as a localStorage entry
//      that the frontend's `better-auth-client` reads on boot. Skips ~10s of
//      navigation per test — use this in tests where login is *not* the
//      subject of the test (almost all "after the user is logged in, can they
//      X?" specs).
//
// DECISION (nie usuwaj tego komentarza):
// We use localStorage injection (not Cookie) because Better Auth in this
// project is configured with the bearer plugin (see AGENTS.md "ZNANE
// DECYZJE ARCHITEKTONICZNE" — sessions via Bearer token, first-class WebView
// support). The frontend reads the bearer token from
// `localStorage[CUSTOM_HEADERS.authorization]` (literal key "authorization")
// — see better-auth-client.ts (`token: () => getFromClientStorage({ key:
// CUSTOM_HEADERS.authorization })`), AuthContext.tsx and currentUser.query.ts,
// all of which read that SAME key with NO prefix. Setting it prior to
// navigation is the canonical way to "start a test pre-authenticated" without
// re-implementing the magic-link round-trip.
//
// r28 half-migration fix: this helper previously injected into
// `better-auth.session_token` — a dead key the frontend never reads. The app
// booted with no token in `localStorage[authorization]`, so any navigation
// bounced straight back to login. The SSOT key is `CUSTOM_HEADERS.authorization`
// (`.shared-kernel/domain/http/http.config.ts`), imported below.

import type { Page, BrowserContext } from '@playwright/test';
// Relative kernel import (not the @kernel tsconfig alias) — matches the rest of
// the e2e helpers (env.ts, cleanup.ts) and guarantees resolution under
// Playwright's runtime, which does not apply tsconfig `paths`.
import { CUSTOM_HEADERS } from '../../../.shared-kernel/domain/http/http.config';
import { E2E_ENV } from './env';
import { dismissCookieBanner } from './ui';
import { fromBackendEnv } from '../../utils/backend-env';

// Canonical session key = the literal value of CUSTOM_HEADERS.authorization
// ("authorization"). The frontend client persists + reads the bearer token
// under this exact key; injecting here makes the next page.goto boot
// authenticated.
const SESSION_STORAGE_KEY: string = CUSTOM_HEADERS.authorization;

interface DevLoginOptions {
  /**
   * When true, appends `?withoutRole=true` so the backend creates a brand-new
   * user WITHOUT a stylist_account or client_account (only meaningful for a
   * not-yet-existing email). This mirrors the real post-signup / pre-onboarding
   * state, which the onboarding-guard routes to /app/onboarding. No-op for an
   * already-existing user (the backend never downgrades an existing account).
   */
  withoutRole?: boolean;
}

/**
 * Fetches a fresh dev-login session token for `email`. Throws if the backend
 * is not running, the DEV gate is closed (NODE_ENV_MANUAL !== DEVELOPMENT),
 * or the test user has not been seeded yet.
 *
 * Exposed separately so individual specs can grab tokens for direct API calls
 * (e.g. cleanup, seeding side state) without spinning up a fresh browser.
 *
 * Pass `{ withoutRole: true }` to mint a role-less account (see DevLoginOptions)
 * — the single code path for both normal and role-less dev-login, so the
 * authorization-header extraction stays in one place.
 */
export async function fetchDevLoginToken(
  email: string,
  options: DevLoginOptions = {}
): Promise<string> {
  const query = options.withoutRole ? '?withoutRole=true' : '';
  const url = `${E2E_ENV.BACKEND_URL}/api/auth/dev-login${query}`;

  // Set INTERNAL_SHARED_SECRET if the backend requires it: the value is sent as the
  // `x-internal-secret` header. We resolve it via the shared backend-env helper
  // (process.env first, then the parsed backend file) instead of reading process.env
  // directly, so host + container + CI all agree.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: E2E_ENV.ORIGIN,
  };
  const internalSecret = fromBackendEnv('INTERNAL_SHARED_SECRET');
  if (internalSecret) {
    headers['x-internal-secret'] = internalSecret;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '<unreadable body>');
    throw new Error(
      `dev-login failed (${response.status} ${response.statusText}) for ${email}. ` +
        `Body: ${bodyText.slice(0, 200)}. ` +
        `Is the backend up on ${E2E_ENV.BACKEND_URL} with NODE_ENV_MANUAL=DEVELOPMENT, and ` +
        `(if the server sets INTERNAL_SHARED_SECRET) is that secret exported to this run? ` +
        `A DEV_LOGIN_BLOCKED body means the gate rejected the request.`
    );
  }

  // AUTH-MIG (r28): token is no longer in the JSON body — the Better Auth bearer
  // plugin returns it in the `authorization` response header (raw value, no
  // "Bearer " prefix), matching CUSTOM_HEADERS['authorization'] consumed by the
  // web client. Mirrors `npm run test:get-stylist-token` which greps this header.
  const token = response.headers.get('authorization');
  if (!token) {
    const bodyText = await response.text().catch(() => '<unreadable>');
    throw new Error(
      `dev-login response missing 'authorization' header for ${email}. Body: ${bodyText.slice(0, 200)}`
    );
  }
  return token;
}

/**
 * Inject a Better Auth bearer token into the page's localStorage so the next
 * navigation starts pre-authenticated. Must be called BEFORE `page.goto(...)`
 * — the storage entry needs to exist when the React app boots.
 *
 * We add it to the BrowserContext (not just one page) so subsequent
 * navigations within the same test inherit the auth state.
 */
export async function injectSessionToken(
  context: BrowserContext,
  token: string
): Promise<void> {
  // Add an init script — runs in every page in this context before any other
  // script. Safe to call multiple times: the last call wins.
  await context.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Some embedded contexts (file://, opaque origins) deny storage. We
        // swallow because the test will fail loudly on the next assertion
        // anyway — surfacing it here would mask the real error.
      }
    },
    { key: SESSION_STORAGE_KEY, value: token }
  );
}

/**
 * Deterministic "the app booted AND the backend accepted the bearer token"
 * signal: resolves once a /api/auth/get-session round-trip completes with a
 * NON-NULL session payload. Replaces `waitForLoadState('networkidle')` in the
 * authed specs — networkidle is timing-based (any quiet 500 ms window passes,
 * even one BEFORE the session request fired), while this waits for the exact
 * request whose response drives the auth-guard's bounce/stay decision.
 *
 * MUST be called (promise created) BEFORE the triggering action
 * (goto / reload / login-tile click) — `page.waitForResponse` only observes
 * responses arriving after registration. Anonymous get-session round-trips
 * (payload `null`) are ignored, so registering on a logged-out page and
 * resolving after the login is the intended usage.
 *
 * Failure modes it catches loudly (timeout):
 *   - token in a dead storage key (r28 half-migration) → get-session goes out
 *     WITHOUT the Authorization header → session:null → never resolves;
 *   - guard-bounce regressions (#7) → no session-bearing round-trip happens.
 */
export function waitForAuthedSessionRoundTrip(
  page: Page,
  timeoutMs = 15_000
): Promise<void> {
  return page
    .waitForResponse(
      async response => {
        if (!response.url().includes('/api/auth/get-session')) {
          return false;
        }
        const body = (await response.json().catch(() => null)) as {
          session?: unknown;
          user?: unknown;
        } | null;
        return Boolean(body?.session ?? body?.user);
      },
      { timeout: timeoutMs }
    )
    .then(() => undefined);
}

/**
 * One-shot helper: fetch a dev-login token for `email` and inject it. After
 * this returns the next `page.goto(...)` will boot the app in an
 * authenticated state.
 */
export async function loginViaDevToken(
  context: BrowserContext,
  email: string
): Promise<string> {
  const token = await fetchDevLoginToken(email);
  await injectSessionToken(context, token);
  return token;
}

/**
 * One-shot helper for the onboarding funnel: create + log in a BRAND-NEW
 * role-less account (no stylist_account, no client_account) and inject its
 * bearer token. The next `page.goto('/app/...')` boots authenticated as a user
 * the onboarding-guard routes to /app/onboarding — i.e. the real post-signup,
 * pre-onboarding state the seeded test stylist (already onboarded) cannot
 * reproduce.
 *
 * Reuses fetchDevLoginToken({ withoutRole: true }) + injectSessionToken (no
 * duplicated fetch/extraction). Pass a UNIQUE `email` per run
 * (e.g. `e2e-fresh-${Date.now()}@example.com`) so repeated runs never collide
 * on an already-onboarded record — the role-less branch only triggers for a
 * not-yet-existing email.
 */
export async function loginAsFreshRolelessUser(
  context: BrowserContext,
  email: string
): Promise<string> {
  const token = await fetchDevLoginToken(email, { withoutRole: true });
  await injectSessionToken(context, token);
  return token;
}

/**
 * Drive the actual /user/login UI. Useful when the login UX is what we are
 * testing. Returns once the post-login redirect has landed somewhere under
 * `/app` (which is the canonical "user is in" signal).
 */
export async function loginViaUI(page: Page, email: string): Promise<void> {
  await page.goto('/user/login');
  // The Quick Login tiles render aria-label `${label}, ${sublabel}` — we match
  // on the email-bearing tile by its visible label (Test Stylist / Test Client
  // / Test Admin). Tiles only render in DEVELOPMENT — fail loudly if missing.
  const tileLabel =
    email === E2E_ENV.USERS.STYLIST
      ? 'Test Stylist'
      : email === E2E_ENV.USERS.CLIENT
        ? 'Test Client'
        : email === E2E_ENV.USERS.ADMIN
          ? 'Test Admin'
          : null;

  if (!tileLabel) {
    throw new Error(
      `loginViaUI: no Quick Login tile is wired for ${email}. ` +
        `Use one of: ${E2E_ENV.USERS.STYLIST}, ${E2E_ENV.USERS.CLIENT}, ${E2E_ENV.USERS.ADMIN}.`
    );
  }

  // Dismiss the cookie-consent banner if present — on narrow viewports it
  // overlays the Quick Login tiles and intercepts pointer events, so the tile
  // click would time out. Shared helper (see helpers/ui.ts) — same dismissal is
  // reused by the recovery-page and pricing-CTA specs.
  await dismissCookieBanner(page);

  // The Quick Login tile is a `<button>` whose accessible name CONTAINS the
  // label. Current a11y form is "Zaloguj jako <label> (<sublabel>)" — so we match
  // by substring (NOT `^`-anchored): an aria-prefix/copy change ("Zaloguj jako ")
  // must not silently break login. The label ("Test Stylist/Client/Admin") is
  // unique per tile, so a contains-match still resolves to exactly one button.
  await page
    .getByRole('button', { name: new RegExp(tileLabel, 'i') })
    .click();

  // After dev-login the SPA pushes to /app. Allow generous time — first
  // /app boot must hydrate global stores (current user, feature flags).
  await page.waitForURL(/\/app(?:\/|$|\?)/, { timeout: 15_000 });
}

/**
 * Same Quick Login tile flow as `loginViaUI`, but opens the login page in the
 * given Next locale so D6 can assert the post-login URL keeps that prefix.
 * `pl` is the default locale (unprefixed `/user/login`); `en`/`de` use
 * `/${locale}/user/login`.
 */
export async function loginViaUIFromLocale(
  page: Page,
  email: string,
  locale: 'en' | 'de' | 'pl'
): Promise<void> {
  const loginPath = locale === 'pl' ? '/user/login' : `/${locale}/user/login`;
  await page.goto(loginPath);
  const tileLabel =
    email === E2E_ENV.USERS.STYLIST
      ? 'Test Stylist'
      : email === E2E_ENV.USERS.CLIENT
        ? 'Test Client'
        : email === E2E_ENV.USERS.ADMIN
          ? 'Test Admin'
          : null;

  if (!tileLabel) {
    throw new Error(
      `loginViaUIFromLocale: no Quick Login tile is wired for ${email}. ` +
        `Use one of: ${E2E_ENV.USERS.STYLIST}, ${E2E_ENV.USERS.CLIENT}, ${E2E_ENV.USERS.ADMIN}.`
    );
  }

  // Locale-aware cookie dismiss: the shared helper matches PL copy only, and
  // on /en|/de the banner labels are English/German (mobile overlay still
  // intercepts the Quick Login tile).
  await dismissCookieBanner(page);
  await page
    .getByRole('button', {
      name: /Accept all|Necessary only|Alle akzeptieren|Nur notwendige/i,
    })
    .first()
    .click({ timeout: 3000 })
    .catch(() => undefined);

  await page.getByRole('button', { name: new RegExp(tileLabel, 'i') }).click();

  await page.waitForURL(/\/app(?:\/|$|\?)/, { timeout: 15_000 });
}

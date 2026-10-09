#!/usr/bin/env node
/**
 * Authenticated Visual QA screenshotter — token-injection variant.
 *
 * WHY: qa-screenshot.cjs uses DEV quick-login tiles (UI click-flow). That
 * approach bounces through /user/login and is fragile when the login UI
 * changes or the page never reaches /app/*. This script fetches a session
 * token via the backend dev-login API, then INJECTS it into localStorage
 * BEFORE the first navigation — React bootstraps with the token already in
 * place, so protected routes render immediately without a redirect.
 *
 * Unlocks /ui Tier 2 visual QA: shoot /app/* screens directly.
 *
 * .cjs IS DELIBERATE: main/package.json has "type":"module"; a .js here would
 * load as ESM and require() would crash. .cjs forces CommonJS.
 *
 * SETUP (once): cd <root> && npx playwright install chromium
 *
 * RUN:
 *   node scripts/qa-authed-screenshot.cjs '<json>' [outdir]
 *
 *   <json> = JSON array of page entries, e.g.:
 *     [
 *       {"url":"/en/for-stylists","name":"lp-stylists"},
 *       {"url":"/app/dashboard","name":"dashboard","auth":"stylist"},
 *       {"url":"/app/admin","name":"admin","auth":"admin"}
 *     ]
 *   outdir defaults to /tmp/ui-qa-authed
 *
 * auth field values: "stylist" | "stylistpro" | "client" | "clientdemo" | "admin"
 *
 * ENV VARS (all optional):
 *   BASE_URL              Frontend base (default: http://localhost:3000)
 *   BACKEND_URL           Backend base (default: http://localhost:3001)
 *   INTERNAL_SHARED_SECRET  If set, forwarded as x-internal-secret header
 *                           to dev-login (needed when gate is configured)
 *
 * DEV-LOGIN GATE: dev-login requires NODE_ENV_MANUAL=DEVELOPMENT on the
 * backend. If gate is closed the script throws immediately with a clear
 * message. Fix: restart backend with NODE_ENV_MANUAL=DEVELOPMENT (or set
 * INTERNAL_SHARED_SECRET matching the server env var).
 *
 * Per page writes:
 *   <name>-light.png   fullPage, 1280-wide, light color scheme
 *   <name>-dark.png    fullPage, 1280-wide, dark color scheme
 *   <name>-mobile.png  fullPage, 390x844
 */
const path = require('path');
const fs = require('fs');
const {
  applyCapturePrep,
  preScroll,
  switchToDark,
  landingProblem,
  createReporter,
} = require('./qa-capture.shared.cjs');

let chromium;
try {
  ({ chromium } = require(
    path.resolve(__dirname, '../node_modules/playwright')
  ));
} catch {
  // Fallback po zwykłym resolve (NODE_PATH / globalna instalacja). Absolutna
  // ścieżka /home/<user>/... byłaby martwa wszędzie poza jedną maszyną.
  ({ chromium } = require('playwright'));
}

const pages = JSON.parse(process.argv[2] || '[]');
const outdir = process.argv[3] || '/tmp/ui-qa-authed';
fs.mkdirSync(outdir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';

// Krok 0: dev-preflight (scripts/dev/preflight.sh) — łapie stale-serving deva
// (uszkodzony .next → [param]=404, stale Prisma client → 500, turbopack
// stale-HTML → fałszywe hydration errory), ZANIM spali całą rundę capture
// (S51: wszystkie trzy klasy w jednej sesji). Tylko dla targetów localhost;
// opt-out: SKIP_PREFLIGHT=1.
const targetsLocalhost =
  BASE.includes('localhost') ||
  pages.some(p => String(p.url).includes('localhost'));
if (!process.env.SKIP_PREFLIGHT && targetsLocalhost) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(
    'bash',
    [path.resolve(__dirname, 'dev/preflight.sh')],
    { stdio: 'inherit', env: { ...process.env, FRONTEND_URL: BASE, BACKEND_URL: BACKEND } }
  );
  if (r.status !== 0) {
    console.error(
      '\nCapture PRZERWANY — dev-stack serwuje stale artefakty (screenshoty byłyby śmieciem).\n' +
        'Napraw wg FIX-ów wyżej albo świadomie pomiń: SKIP_PREFLIGHT=1'
    );
    process.exit(1);
  }
}

// DECISION (nie usuwaj tego komentarza):
// Token email map — SSOT: .shared-kernel/config/test-users.config.ts.
// "client" role maps to CLIENT test user; "stylist" to STYLIST; "admin" to ADMIN.
// Strings are literal copies from TEST_USERS_CONFIG to avoid a runtime import
// (this is a CJS Node script, not part of the TS build).
const AUTH_EMAILS = {
  stylist: 'test-stylist-main@example.com',
  // demo-stylist = PRO plan + seeded content (paired clients, sessions, notes).
  // Use auth:'stylistpro' to QA paid-plan screens (client-card, history, etc.);
  // 'stylist' is FREE and hits upgrade/locked walls. SSOT: test-users.config.ts.
  stylistpro: 'demo-stylist-main@example.com',
  client: 'test-client-main@example.com',
  // demo-client = seeded sessions/pairs; test-client bounces to onboarding
  // (plan-guard) mid-QA. Use auth:'clientdemo' for client-role app screens.
  clientdemo: 'demo-client-main@example.com',
  admin: 'test-admin-main@example.com',
};

/**
 * Fetch a dev-login session token for the given email.
 * Returns the raw token string (value for the `authorization` header).
 * Throws on any failure, including DEV_LOGIN_BLOCKED gate.
 */
async function fetchDevLoginToken(email) {
  const url = `${BACKEND}/api/auth/dev-login`;
  const headers = {
    'content-type': 'application/json',
    // Origin must be an allowed origin — cors.middleware.ts validates this.
    Origin: 'http://localhost:3000',
  };

  // Optional: forward INTERNAL_SHARED_SECRET if configured.
  // Needed when dev-login is gated (INTERNAL_SHARED_SECRET set on backend).
  // Without it the gate uses IS_DEVELOPMENT_ENV() as sole guard (graceful local dev).
  const secret = process.env.INTERNAL_SHARED_SECRET;
  if (secret) {
    headers['x-internal-secret'] = secret;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  });

  // Check for DEV_LOGIN_BLOCKED body — happens in PROD or when secret is wrong.
  // Read body regardless of status code (body may hold diagnostic info).
  const bodyText = await res.text();

  if (bodyText.includes('DEV_LOGIN_BLOCKED')) {
    throw new Error(
      `DEV_LOGIN_BLOCKED — dev-login gate is closed.\n` +
        `  Backend: ${url}\n` +
        `  Fix: restart web-1 with NODE_ENV_MANUAL=DEVELOPMENT, ` +
        `or set INTERNAL_SHARED_SECRET env matching the server.\n` +
        `  Note: INTERNAL_SHARED_SECRET can be passed to this script ` +
        `via env: INTERNAL_SHARED_SECRET=<value> node scripts/qa-authed-screenshot.cjs ...`
    );
  }

  if (!res.ok) {
    throw new Error(
      `dev-login failed — HTTP ${res.status} from ${url}\n` +
        `  email: ${email}\n` +
        `  body: ${bodyText}`
    );
  }

  // DECISION (nie usuwaj tego komentarza):
  // Token is returned in the `authorization` response header, NOT in the body.
  // Backend: setClientHeader -> res.setHeader(SESSION_HEADER_NAME, session.token)
  //          SESSION_HEADER_NAME = CUSTOM_HEADERS.authorization = 'authorization'
  // This is the same header the frontend reads from localStorage (key: 'authorization').
  // Source: session.utils.api.ts + http.config.ts CUSTOM_HEADERS.authorization.
  const token = res.headers.get('authorization');
  if (!token) {
    throw new Error(
      `dev-login succeeded (HTTP ${res.status}) but response has no 'authorization' header.\n` +
        `  email: ${email}\n` +
        `  body: ${bodyText}`
    );
  }

  return token;
}

/**
 * Inject the session token into localStorage BEFORE any navigation.
 * addInitScript runs before any page script — React bootstraps with the
 * token already present, so auth guards see a valid session immediately.
 */
async function injectToken(context, token) {
  // DECISION (nie usuwaj tego komentarza):
  // localStorage key = CUSTOM_HEADERS.authorization = 'authorization' (ground-truth).
  // This is NOT 'better-auth.session_token' (which is the Better Auth cookie-mode key).
  // Frontend reads: localStorage.getItem(CUSTOM_HEADERS.authorization) in the
  // authorization header plugin. Using 'better-auth.session_token' here would be
  // silently ignored and the session would not be established.
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: 'authorization', value: token }
  );

}

(async () => {
  const report = createReporter();

  // Token cache: per-role token fetched once and reused across all pages of that role.
  const tokenCache = {};

  async function getToken(auth) {
    if (tokenCache[auth]) return tokenCache[auth];
    const email = AUTH_EMAILS[auth];
    if (!email) {
      throw new Error(
        `Unknown auth role '${auth}'. Valid values: ${Object.keys(AUTH_EMAILS).join(', ')}`
      );
    }
    const token = await fetchDevLoginToken(email);
    tokenCache[auth] = token;
    return token;
  }

  // Pre-fetch all required tokens before launching the browser.
  // Fail fast if dev-login gate is closed — no point launching Chromium.
  const requiredRoles = [
    ...new Set(pages.filter(p => p.auth).map(p => p.auth)),
  ];
  for (const role of requiredRoles) {
    process.stdout.write(`Fetching token for role '${role}'... `);
    await getToken(role);
    process.stdout.write('OK\n');
  }

  const browser = await chromium.launch({ headless: true });

  for (const { url, name, auth } of pages) {
    const full = url.startsWith('http') ? url : `${BASE}${url}`;

    try {
      // --- Light (desktop) ---
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
        colorScheme: 'light',
      });

      await applyCapturePrep(ctx, { themeSlug: process.env.THEME_SLUG });
      if (auth) {
        const token = await getToken(auth);
        await injectToken(ctx, token);
      }

      const page = await ctx.newPage();
      await page
        .goto(full, { waitUntil: 'networkidle', timeout: 45000 })
        .catch(() => {});
      await page.waitForTimeout(2200);
      const problem = landingProblem(page, full);
      if (problem) throw new Error(problem);
      await preScroll(page);
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `${outdir}/${name}-light.png`,
        fullPage: true,
      });

      // --- Dark (reuse same context/page — no re-login needed, token is in localStorage) ---
      await switchToDark(page);
      await page.waitForTimeout(700);
      await page.screenshot({
        path: `${outdir}/${name}-dark.png`,
        fullPage: true,
      });
      await ctx.close();

      // --- Mobile ---
      const mctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: 'light',
        isMobile: true,
        hasTouch: true,
      });

      await applyCapturePrep(mctx, { themeSlug: process.env.THEME_SLUG });
      if (auth) {
        const token = await getToken(auth);
        await injectToken(mctx, token);
      }

      const mpage = await mctx.newPage();
      await mpage
        .goto(full, { waitUntil: 'networkidle', timeout: 45000 })
        .catch(() => {});
      await mpage.waitForTimeout(2000);
      const mproblem = landingProblem(mpage, full);
      if (mproblem) throw new Error(mproblem);
      await preScroll(mpage, { step: 600, pause: 100 });
      await mpage.waitForTimeout(600);
      await mpage.screenshot({
        path: `${outdir}/${name}-mobile.png`,
        fullPage: true,
      });

      // --- Mobile dark (app jest dark-capable; parity na mobile = podstawowa
      // powierzchnia produktu, desktop-dark nie wystarcza) ---
      await switchToDark(mpage);
      await mpage.waitForTimeout(700);
      await mpage.screenshot({
        path: `${outdir}/${name}-mobile-dark.png`,
        fullPage: true,
      });
      await mctx.close();

      report.ok(name);
    } catch (e) {
      report.fail(name, e.message);
    }
  }

  await browser.close();
  report.finish();
})();

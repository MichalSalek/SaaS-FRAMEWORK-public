#!/usr/bin/env node
/**
 * Visual QA screenshotter (bundled-chromium, MCP-independent) — Nailfolio.
 *
 * WHY: Playwright MCP plugin is configured for the `chrome` channel and fails
 * in this env ("Chromium distribution 'chrome' is not found at
 * /opt/google/chrome/chrome"). Doc-based "fly blind" QA tanks UI quality.
 * This drives the BUNDLED chromium that `npx playwright install chromium`
 * provides, giving real light/dark/mobile screenshots to Read back. Visual
 * feedback is the single biggest lever on UI quality — never redesign blind.
 * Used by the /ui skill. THIS project-local copy adds Nailfolio
 * DEV quick-login so auth-gated /app/* screens can be shot.
 *
 * .cjs IS DELIBERATE: main/package.json has "type":"module"; a .js here would
 * load as ESM and require() would crash. .cjs forces CommonJS.
 *
 * SETUP (once): cd <root> && npx playwright install chromium
 * RUN: node scripts/qa-screenshot.cjs '<json>' [outdir]
 *   <json> = [{"url":"http://localhost:3000/pricing","name":"pricing"}, ...]
 *   outdir defaults to /tmp/ui-qa
 * Per page writes <name>-light.png (fullPage), <name>-dark.png (fullPage),
 * <name>-mobile.png (390x844). Read those PNGs back.
 *
 * BEFORE/AFTER: shoot a target BEFORE dispatching its redesign agent (baseline)
 * and again AFTER — comparing the two catches regressions and confirms a real
 * lift, not a different flavour of mediocre.
 *
 * AUTH-GATED screens (/app/*, sometimes /status) redirect to
 * /user/login when unauthenticated. To screenshot them, pass
 * {auth:"stylist"|"client"|"admin"} on the page entry — the script clicks the
 * matching DEV quick-login tile on /user/login first, then navigates.
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
  ({ chromium } = require(path.resolve(__dirname, '../node_modules/playwright')));
} catch {
  // Fallback po zwykłym resolve (NODE_PATH / globalna instalacja). Absolutna
  // ścieżka /home/<user>/... byłaby martwa wszędzie poza jedną maszyną.
  ({ chromium } = require('playwright'));
}

const pages = JSON.parse(process.argv[2] || '[]');
const outdir = process.argv[3] || '/tmp/ui-qa';
fs.mkdirSync(outdir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// Krok 0: dev-preflight — łapie stale-serving deva ([param]=404 / stale Prisma /
// turbopack stale-HTML / port frontu przejęty przez host) zanim spali rundę
// capture (S51). Tylko dla targetów localhost; opt-out: SKIP_PREFLIGHT=1.
// Detale: scripts/dev/preflight.sh.
const targetsLocalhost =
  BASE.includes('localhost') ||
  pages.some(p => String(p.url).includes('localhost'));
if (!process.env.SKIP_PREFLIGHT && targetsLocalhost) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('bash', [path.resolve(__dirname, 'dev/preflight.sh')], {
    stdio: 'inherit',
    env: { ...process.env, FRONTEND_URL: BASE },
  });
  if (r.status !== 0) {
    console.error(
      '\nCapture PRZERWANY — dev-stack serwuje stale artefakty (screenshoty byłyby śmieciem).\n' +
        'Napraw wg FIX-ów wyżej albo świadomie pomiń: SKIP_PREFLIGHT=1'
    );
    process.exit(1);
  }
}

// Etykiety kafelków Quick Login = display_name z SSOT
// .shared-kernel/config/test-users.config.ts (literal copy — to skrypt CJS, nie ma
// jak zaimportować TS; ten sam kompromis co AUTH_EMAILS w qa-authed-screenshot.cjs).
const QUICK_LOGIN_LABELS = {
  stylist: 'Test Stylist',
  client: 'Test Client',
  admin: 'Test Admin',
};

async function quickLogin(page, role) {
  const label = QUICK_LOGIN_LABELS[role];
  if (!label) {
    throw new Error(
      `Nieznana rola '${role}'. Dozwolone: ${Object.keys(QUICK_LOGIN_LABELS).join(', ')}`
    );
  }
  await page
    .goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  const tile = page.getByText(label, { exact: false }).first();
  try {
    await tile.click({ timeout: 5000 });
  } catch {
    // Panel Quick Login jest gated `NODE_ENV === DEVELOPMENT`, a etykieta to
    // display_name z kernela — jedno i drugie potrafi zniknąć/zmienić się.
    throw new Error(
      `nie znalazłem kafelka Quick Login '${label}' na ${BASE}/user/login ` +
        `(panel dev wyłączony albo display_name zmieniony w test-users.config.ts)`
    );
  }

  // devLogin_IO → successCallback → router.push('/app'). Czekamy na redirect, bo
  // bez ustanowionej sesji Bearer kolejna nawigacja odbije na /user/login i
  // zrzucilibyśmy ekran logowania, raportując „OK".
  try {
    await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 20000 });
  } catch {
    throw new Error(
      `quick-login '${role}' nie ustanowił sesji (po kliknięciu nadal ${page.url()})`
    );
  }
  await page.waitForTimeout(1800);
}

(async () => {
  const report = createReporter();
  const browser = await chromium.launch({ headless: true });

  for (const { url, name, auth } of pages) {
    const full = url.startsWith('http') ? url : `${BASE}${url}`;
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
        colorScheme: 'light',
      });
      await applyCapturePrep(ctx, { themeSlug: process.env.THEME_SLUG });
      const page = await ctx.newPage();
      if (auth) await quickLogin(page, auth);
      await page.goto(full, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(2200);
      const problem = landingProblem(page, full);
      if (problem) throw new Error(problem);
      await preScroll(page);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${outdir}/${name}-light.png`, fullPage: true });

      await switchToDark(page);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${outdir}/${name}-dark.png`, fullPage: true });
      await ctx.close();

      const mctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme: 'light',
        isMobile: true,
        hasTouch: true,
      });
      await applyCapturePrep(mctx, { themeSlug: process.env.THEME_SLUG });
      const mpage = await mctx.newPage();
      if (auth) await quickLogin(mpage, auth);
      await mpage.goto(full, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
      await mpage.waitForTimeout(2000);
      const mproblem = landingProblem(mpage, full);
      if (mproblem) throw new Error(mproblem);
      await preScroll(mpage, { step: 600, pause: 100 });
      await mpage.waitForTimeout(700);
      await mpage.screenshot({ path: `${outdir}/${name}-mobile.png`, fullPage: true });
      await mctx.close();

      report.ok(name);
    } catch (e) {
      report.fail(name, e.message);
    }
  }

  await browser.close();
  report.finish();
})();

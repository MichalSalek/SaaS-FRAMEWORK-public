// FDX FAZA 8 / W8.0 + FQC FAZA 5 — axe-core runtime baseline.
// Runs axe (WCAG 2.1 A+AA) against key surfaces on the live dev server, in BOTH
// light and dark mode. Static a11y is covered by eslint-plugin-jsx-a11y; this
// catches what static cannot (contrast, runtime ARIA states, landmark/heading).
//
// FQC FAZA 5 additions:
//   - Dark-mode pass on every surface (FDX measured only light).
//   - Optional app-zone sweep (pages/app/**) when AXE_APP_TOKEN is provided
//     (get it via: INTERNAL_SHARED_SECRET=<hex> dev-login → authorization header,
//     or `npm run test:get-stylist-token` / `test:get-admin-token`). Without the
//     token the app-zone is skipped (public surfaces still run).
//
// Usage: node tests/a11y/axe-baseline.mjs                  (public, light+dark)
//        AXE_APP_TOKEN=<bearer> node tests/a11y/axe-baseline.mjs   (+ app-zone)
//   (dev server must be up on :3000; app-zone also needs web-1 backend up.)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const axeSource = readFileSync(
  join(__dirname, '../../main/node_modules/axe-core/axe.min.js'),
  'utf8'
);

const BASE = 'http://localhost:3000';

const PUBLIC_SURFACES = [
  ['/en', 'home'],
  ['/en/for-stylists', 'for-stylists'],
  ['/en/pricing', 'pricing'],
  ['/en/get-app', 'get-app'],
  ['/en/contact', 'contact'],
];

// App-zone surfaces (require auth). Stylist-role visible set; admin pages need
// an admin token. Filename=URL after Next locale prefix.
const APP_SURFACES = [
  ['/en/app/dashboard', 'app-dashboard'],
  ['/en/app/gallery', 'app-gallery'],
  ['/en/app/explore', 'app-explore'],
  ['/en/app/favorites', 'app-favorites'],
  ['/en/app/shared', 'app-shared'],
  ['/en/app/user/account', 'app-account'],
  ['/en/app/user/activity', 'app-activity'],
];

const APP_TOKEN = process.env.AXE_APP_TOKEN ?? '';

const browser = await chromium.launch();
let totalViolations = 0;

/** Run axe on the current page DOM and print violations (+ contrast detail). */
async function runAxe(page, label) {
  await page.evaluate(axeSource);
  const results = await page.evaluate(async () => {
    // @ts-ignore — axe injected above
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  });
  const v = results.violations;
  totalViolations += v.length;
  console.log(`\n=== ${label} — ${v.length} violation type(s) ===`);
  for (const item of v) {
    console.log(`  [${item.impact}] ${item.id} (${item.nodes.length}×) — ${item.help}`);
    if (item.id === 'color-contrast') {
      const seen = new Set();
      for (const node of item.nodes) {
        const d = node.any?.[0]?.data ?? {};
        const key = `${d.fgColor}|${d.bgColor}|${d.contrastRatio}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(
          `      fg=${d.fgColor} bg=${d.bgColor} ratio=${d.contrastRatio} need=${d.expectedContrastRatio} — ${String(node.target).slice(0, 80)}`
        );
      }
    }
  }
}

/** Visit a surface and run axe in both light and dark mode. */
async function sweepSurface(page, path, label) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  // Light (default).
  await page.evaluate(() => document.documentElement.setAttribute('data-mode', 'light'));
  await runAxe(page, `${label} [light] (${path})`);
  // Dark — FQC FAZA 5: dark-mode contrast sweep (FDX measured only light).
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-mode', 'dark');
    document.documentElement.style.colorScheme = 'dark';
  });
  await page.waitForTimeout(150);
  await runAxe(page, `${label} [dark] (${path})`);
}

// ── Public surfaces (no auth) ──
const pubPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
for (const [path, label] of PUBLIC_SURFACES) {
  await sweepSurface(pubPage, path, label);
}
await pubPage.close();

// ── App-zone surfaces (auth required; skipped without AXE_APP_TOKEN) ──
if (APP_TOKEN) {
  const appPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Seed the bearer token the way the app reads it (localStorage['authorization']).
  await appPage.goto(BASE + '/en', { waitUntil: 'domcontentloaded' });
  await appPage.evaluate((tok) => localStorage.setItem('authorization', tok), APP_TOKEN);
  for (const [path, label] of APP_SURFACES) {
    await sweepSurface(appPage, path, label);
  }
  await appPage.close();
} else {
  console.log('\n[app-zone SKIPPED — set AXE_APP_TOKEN=<bearer> to sweep pages/app/** (light+dark)]');
}

console.log(`\nTOTAL violation types across surfaces (light+dark): ${totalViolations}`);
await browser.close();

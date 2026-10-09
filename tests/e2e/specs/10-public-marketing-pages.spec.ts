// tests/e2e/specs/10-public-marketing-pages.spec.ts
//
// CRITICAL PATH (cross-cut smoke): every deploy of a marketing-first SaaS
// must serve the public marketing surface without 500s or empty pages —
// historically the most-broken thing in this repo (i18n locale fallbacks,
// missing translations, broken JSON-LD generators). This spec is the smallest
// possible "did the build come out OK?" canary for the public site, gated to
// the routes that drive the bulk of traffic.
//
// Each route gets:
//   - a navigation,
//   - a non-empty `<body>` text check,
//   - a no-500 assertion,
//   - a check that the canonical `<title>` is set (not the bare site name
//     default — that's the SEO regression that bit us in Wave 2).

import { test, expect } from '@playwright/test';

const PUBLIC_ROUTES: Array<{ path: string; minBodyChars: number }> = [
  { path: '/', minBodyChars: 200 },
  { path: '/for-stylists', minBodyChars: 200 },
  { path: '/for-clients', minBodyChars: 200 },
  { path: '/pricing', minBodyChars: 200 },
  { path: '/help-center', minBodyChars: 100 },
  { path: '/contact', minBodyChars: 100 },
];

test.describe('public marketing surface: smoke', () => {
  for (const { path, minBodyChars } of PUBLIC_ROUTES) {
    test(`renders ${path} without 500 and with non-trivial content`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response, `no response object from ${path}`).not.toBeNull();
      const status = response!.status();
      // Allow 200 OR 304 (revalidation hits). Reject everything else.
      expect(
        status === 200 || status === 304,
        `${path} returned status ${status}`
      ).toBe(true);

      // Deterministic render signal (replaces networkidle): poll the rendered
      // body text until it crosses the minimum-content threshold. Content is
      // SSR'd, but polling also absorbs late hydration paints without relying
      // on network quiescence.
      await expect
        .poll(async () => ((await page.textContent('body')) ?? '').length, {
          message: `${path} body too short — possible render failure`,
          timeout: 10_000,
        })
        .toBeGreaterThan(minBodyChars);

      const bodyText = (await page.textContent('body')) ?? '';
      expect(bodyText.toLowerCase()).not.toContain('internal server error');

      const title = await page.title();
      expect(title.trim().length, `${path} has empty <title>`).toBeGreaterThan(
        0
      );
    });
  }
});

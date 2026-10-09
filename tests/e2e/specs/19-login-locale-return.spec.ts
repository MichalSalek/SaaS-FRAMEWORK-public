// tests/e2e/specs/19-login-locale-return.spec.ts
//
// D6 — locale-preserving login return. Quick Login from a locale-prefixed
// login page must land under that locale's /app zone (not drop to /app or
// bounce back to /user/login). `pl` is the Next default locale and stays
// unprefixed.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  loginViaUIFromLocale,
  waitForAuthedSessionRoundTrip,
} from '../helpers/auth';
import { E2E_ENV } from '../helpers/env';

const PREFIXED_APP = /^\/(en|de)\/app(\/|$)/;
const DEFAULT_APP = /^\/app(\/|$)/;

async function signOutBetweenCases(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto('/user/login');
}

test.describe('login preserves locale on return (D6)', () => {
  test.afterEach(async ({ page }) => {
    await signOutBetweenCases(page);
  });

  for (const locale of ['en', 'de'] as const) {
    test(`Quick Login from /${locale}/user/login lands on /${locale}/app`, async ({
      page,
    }) => {
      const authedLogin = waitForAuthedSessionRoundTrip(page);
      await loginViaUIFromLocale(page, E2E_ENV.USERS.STYLIST, locale);
      await authedLogin;

      const pathname = new URL(page.url()).pathname;
      expect(pathname).toMatch(PREFIXED_APP);
      expect(pathname.startsWith(`/${locale}/app`)).toBe(true);
      expect(pathname).not.toContain('/user/login');
      await expect(page).not.toHaveURL(/\/user\/login/);
    });
  }

  test('Quick Login from /user/login (pl) lands on unprefixed /app', async ({
    page,
  }) => {
    const authedLogin = waitForAuthedSessionRoundTrip(page);
    await loginViaUIFromLocale(page, E2E_ENV.USERS.STYLIST, 'pl');
    await authedLogin;

    const pathname = new URL(page.url()).pathname;
    expect(pathname).toMatch(DEFAULT_APP);
    expect(pathname.startsWith('/en/')).toBe(false);
    expect(pathname.startsWith('/de/')).toBe(false);
    await expect(page).not.toHaveURL(/\/user\/login/);
  });
});

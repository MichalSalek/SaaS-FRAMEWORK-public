// tests/e2e/specs/18-bottom-tab-navigation.spec.ts
//
// FAZA 3 (Frontend DX Refactor) regression guard for the AppLayout
// decomposition: the bottom-tab logic was extracted from AppLayout into
// `useAppTabs` (onClick wiring) + `useActiveTab` / `resolveActiveTabPath`
// (active-tab resolution) + `appTabs.config` (per-role tab sets). This spec
// proves the extracted behavior end-to-end against a live stack.
//
// LOCATOR DOCTRINE (tests/FRONTEND_TESTING.md): ARIA only. The active tab is
// the one BottomTabBar marks with `aria-current="page"` — we never assert on
// CSS classes or DOM structure. The bottom nav is scoped as the <nav> that
// CONTAINS an active tab button, so we don't depend on the i18n nav label.

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loginViaUI } from '../helpers/auth';
import { E2E_ENV } from '../helpers/env';

// The bottom tab bar = the navigation landmark holding the aria-current tab.
const bottomNav = (page: Page) =>
  page.locator('nav', { has: page.locator('button[aria-current="page"]') });

const activeTabs = (page: Page) =>
  page.locator('nav button[aria-current="page"]');

test.describe('bottom-tab navigation (FAZA 3: useAppTabs / useActiveTab)', () => {
  test('stylist: exactly one active tab on a tab route + sub-route', async ({
    page,
  }) => {
    await loginViaUI(page, E2E_ENV.USERS.STYLIST);

    // Exact /app → Dashboard is the single active tab (APP matches exact-only).
    await page.goto('/app');
    await expect(activeTabs(page)).toHaveCount(1);

    // A real tab's sub-route keeps exactly one tab active (longest-prefix).
    await page.goto('/app/gallery');
    await expect(activeTabs(page)).toHaveCount(1);
  });

  test('stylist: clicking the gallery tab navigates (useAppTabs onClick wiring)', async ({
    page,
  }) => {
    await loginViaUI(page, E2E_ENV.USERS.STYLIST);
    await page.goto('/app');

    const nav = bottomNav(page);
    await expect(nav).toBeVisible();
    // STYLIST_TABS order (SSOT appTabs.config): [dashboard, myGallery, …].
    // Index 1 = "Moja galeria" → view-transition navigation to /app/gallery.
    await nav.locator('button').nth(1).click();

    await expect(page).toHaveURL(/\/app\/gallery(?:\/|$|\?)/);
    await expect(activeTabs(page)).toHaveCount(1);
  });

  test('client: bottom nav renders with a single active tab on /app', async ({
    page,
  }) => {
    await loginViaUI(page, E2E_ENV.USERS.CLIENT);
    await page.goto('/app');

    await expect(bottomNav(page)).toBeVisible();
    await expect(activeTabs(page)).toHaveCount(1);
  });
});

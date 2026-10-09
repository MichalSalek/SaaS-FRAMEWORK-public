// tests/e2e/specs/11-trial-checkout.spec.ts
//
// CRITICAL PATH #11 (Plan selection → embedded checkout surface):
//   Stylist (authenticated) enters the paid-plan checkout. We exercise the
//   LIVE surface (SPE embedded, D9): the ACCOUNT_CHECKOUT_SESSION API mints a
//   usable checkout (discriminated-union body keyed by `mode`), and the
//   /pricing CTAs are wired into the pay funnel. The legacy hosted
//   ACCOUNT_START_TRIAL endpoint was removed 2026-07-09 — a trial is now
//   claimed inside the embedded checkout, not via a standalone redirect route.
//
// SCOPE NOTE (pragmatic, mirrors spec 02):
//   Stripe's hosted checkout page is explicitly scoped OUT — scripted browsers
//   cannot traverse Stripe's own pages (bot detection + MFA), and following the
//   payment through requires webhooks replayed to the dev backend. We verify:
//     a) ACCOUNT_CHECKOUT_SESSION is reachable and returns a recognised `mode`
//        (checkout_elements → clientSecret / free_selected / hosted_fallback),
//     b) the pricing CTAs carry a plan intent and navigate into the pay funnel,
//     c) the Stripe billing-portal route is reachable for an authed stylist.

import { test, expect } from '@playwright/test';
import { loginViaDevToken } from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { dismissCookieBanner } from '../helpers/ui';
import { E2E_ENV } from '../helpers/env';
import {
  ROUTES_API,
  ROUTES_FRONT,
} from '../../../.shared-kernel/domain/routing/routing.config';
import { PricingPlanValue } from '../../../.shared-kernel/domain/pricing/pricing.config';

test.describe('trial → checkout flow', () => {
  let stylistToken = '';

  test.beforeAll(async () => {
    stylistToken = await fetchStylistToken();
  });

  test('checkout-session API is reachable and returns a usable checkout', async () => {
    // Direct API probe of the LIVE checkout surface (SPE embedded, D9). We probe
    // ACCOUNT_CHECKOUT_SESSION — NOT the legacy ACCOUNT_START_TRIAL, which is
    // SUPERSEDED and deliberately returns 500 when embedded checkout is the
    // active surface (account-stripe.operations.ts DECISION: the null-guard is
    // the intended signal that the legacy hosted-redirect flow is dead). Probing
    // the dead endpoint would assert a by-design 500 == a crash, which is wrong.
    //
    // A healthy backend returns 200 with a discriminated-union body keyed by
    // `mode` (checkout_elements → clientSecret / free_selected / hosted_fallback).
    const result = await apiCall<{
      data?: { mode?: string; clientSecret?: string; url?: string };
      event?: string;
    }>(ROUTES_API.ACCOUNT_CHECKOUT_SESSION, {
      method: 'POST',
      token: stylistToken,
      body: {
        planId: PricingPlanValue.PRO,
        billingPeriod: 'month',
        source: 'e2e-checkout-probe',
      },
    });

    // Accept 200 (checkout minted), 409 (already active), 422 (plan ineligible).
    // Reject 401/403 (auth broken) and 5xx (handler crash).
    expect(
      [200, 409, 422].includes(result.status),
      `checkout-session returned unexpected status ${result.status}. Body: ${JSON.stringify(result.body).slice(0, 300)}`
    ).toBe(true);
    expect(result.status).not.toBe(401);
    expect(result.status).not.toBe(403);

    // "Usable checkout": a 200 must carry a recognised discriminated-union mode,
    // and an embedded checkout must actually ship a clientSecret (an empty/garbled
    // 200 body would otherwise pass a status-only check while shipping nothing the
    // client can render).
    if (result.status === 200) {
      const mode = result.body?.data?.mode ?? '';
      expect(
        ['checkout_elements', 'free_selected', 'hosted_fallback'].includes(mode),
        `checkout-session 200 with unrecognised mode: ${JSON.stringify(result.body?.data).slice(0, 200)}`
      ).toBe(true);
      if (mode === 'checkout_elements') {
        expect(result.body?.data?.clientSecret).toBeTruthy();
      }
    }
  });

  test('pricing page renders plan CTAs wired to the checkout funnel', async ({
    page,
    context,
  }) => {
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);

    await page.goto('/pricing');

    // The pricing plan CTAs enter the checkout/pay funnel (S43 web-login-first).
    // For a logged-in stylist the non-current tiers link straight to the in-app
    // pay page (buildPlanPayDeepLink → USER_ACCOUNT_PAY?planId=...); the logged-
    // out fallback links to the login funnel carrying the same pay route encoded
    // in `from=`. Either way the CTA is an <a> whose href points at the pay route
    // and carries a plan intent (planId=). The CURRENT plan's CTA is a disabled
    // marker ("Twój obecny plan") inside a <span> — deliberately not a link — so
    // targeting the pay-route <a> naturally skips it and only matches the
    // enabled, navigable CTAs. SSOT for the route: ROUTES_FRONT.USER_ACCOUNT_PAY.
    const payRoute = ROUTES_FRONT.USER_ACCOUNT_PAY;
    const payCta = page
      .locator(
        `a[href*="${payRoute}"], a[href*="${encodeURIComponent(payRoute)}"]`
      )
      .first();

    // Auto-waiting CTA visibility doubles as the deterministic hydration
    // signal (replaces networkidle): tier CTAs render once the plans resolved.
    await expect(payCta).toBeVisible({ timeout: 10_000 });

    // Cookie banner dismissed AFTER hydration (it is client-rendered) and
    // BEFORE the click below — on narrow viewports it intercepts pointers.
    await dismissCookieBanner(page);

    // Pricing page must render recognisable content.
    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.length).toBeGreaterThan(50);

    const href = await payCta.getAttribute('href');
    expect(
      href,
      `plan CTA href should carry a plan intent (planId=), got: ${href}`
    ).toMatch(/planId=/i);

    // Following it must leave /pricing for the checkout funnel (pay page when
    // logged in, or the login funnel) — proves the CTA is actually navigable,
    // not merely present.
    await payCta.click();
    await page.waitForURL(/\/app\/user\/account\/pay|\/user\/login/i, {
      timeout: 15_000,
    });
  });

  test('stripe portal endpoint is reachable for authenticated stylist', async () => {
    // Secondary probe: the portal route is the post-trial management surface.
    // Accept 200 (portal URL returned) or 404/409 (no active subscription yet).
    const result = await apiCall<{ data?: { url?: string }; event?: string }>(
      ROUTES_API.ACCOUNT_STRIPE_PORTAL,
      { method: 'POST', token: stylistToken, body: {} }
    );

    expect(
      [200, 404, 409, 422].includes(result.status),
      `stripe/portal returned ${result.status}. Body: ${JSON.stringify(result.body).slice(0, 200)}`
    ).toBe(true);
    // Must not be 401 (unauthenticated) or 5xx.
    expect(result.status).not.toBe(401);
    expect(result.status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchStylistToken(): Promise<string> {
  const { fetchDevLoginToken } = await import('../helpers/auth');
  return fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
}

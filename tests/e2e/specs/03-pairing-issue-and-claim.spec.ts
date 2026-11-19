// tests/e2e/specs/03-pairing-issue-and-claim.spec.ts
//
// CRITICAL PATH #3 (QR pairing to full gallery access), permanent-QR model:
//   1. An authenticated stylist can still mint a pairing session via the backend contract
//      (issue-session, 201 + token), even though the generated-code UI was removed.
//   2. An unauthenticated visitor opens the PERMANENT QR target: the stylist's PUBLIC PROFILE page
//      (/stylist/[identifier]?from=qr). The QR poster encodes the public profile URL (owner decision);
//      the old /pairing/claim page no longer exists (it renders the custom 404).
//
// This proves the public QR landing loads for an anonymous visitor: the failure mode to guard is a
// server-generated URL that the client-side page silently 404s on. The full "client logs in and pairs"
// flow is not carried through; it needs client auth (spec 01) and gallery surfaces (spec 04) for
// marginal extra coverage.

import { test, expect } from '@playwright/test';
import { fetchDevLoginToken } from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { cleanupPairingsForToken } from '../helpers/cleanup';
import { E2E_ENV } from '../helpers/env';

test.describe('pairing: issue-session contract + permanent QR landing', () => {
  let stylistToken = '';

  test.beforeAll(async () => {
    stylistToken = await fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
    await cleanupPairingsForToken(stylistToken);
  });

  test.afterAll(async () => {
    // Revoke whatever sessions/pairs were created so the next run starts
    // from the FREE-plan zero-pair baseline.
    await cleanupPairingsForToken(stylistToken);
  });

  test('issue-session API contract still mints a claimable token', async () => {
    // The generated-code UI is gone (permanent-QR only), but the backend
    // contract remains part of the API SSOT — a silent 500/404 here would
    // mean kernel/handler drift, so we pin the 201 + token shape.
    const issued = await apiCall<{
      data?: { token?: string };
    }>('/api/v1/pairing/issue-session', {
      method: 'POST',
      token: stylistToken,
      body: {},
    });
    // issue-session creates a pairing-session resource → respondCreated (201),
    // per web-1/.../pairing/issue-session (CQRS: create commands return 201).
    expect(issued.status).toBe(201);
    const token = issued.body?.data?.token;
    expect(
      token,
      `issue-session payload: ${JSON.stringify(issued.body).slice(0, 200)}`
    ).toBeTruthy();
  });

  test('permanent QR target: public stylist profile renders for anonymous visitor', async ({
    page,
  }) => {
    // 1. Resolve a live, publicly visible stylist identifier the same way
    //    the sitemap does (public endpoint, no auth) — identical visibility
    //    rules to the profile page itself (STYLIST_PUBLICLY_VISIBLE).
    const profiles = await apiCall<{
      data?: { profiles?: Array<{ identifier?: string }> };
    }>('/api/v1/public/sitemap-profiles', { method: 'GET' });
    expect(profiles.status).toBe(200);
    const identifier = profiles.body?.data?.profiles?.[0]?.identifier;
    expect(
      identifier,
      `sitemap-profiles payload: ${JSON.stringify(profiles.body).slice(0, 200)}`
    ).toBeTruthy();

    // 2. Anonymous visitor opens the QR-encoded URL (?from=qr = poster scan
    //    marker, same shape StylistPermanentCode encodes into the QR).
    await page.goto(`/stylist/${identifier}?from=qr`);

    // 3. The page renders the real profile, not the custom not-found route.
    //    The custom 404 keeps a friendly title, so we assert on its unique
    //    copy instead of the title, then require profile content visible.
    await expect(
      page.getByText(/strona nie znaleziona/i),
      'public profile URL fell through to the custom 404 page'
    ).toHaveCount(0);
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible(
      { timeout: 15_000 }
    );
  });
});

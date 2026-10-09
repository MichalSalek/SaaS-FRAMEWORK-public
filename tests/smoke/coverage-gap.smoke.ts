/**
 * Coverage gap smoke tests
 *
 * Endpoints identified as MEDIUM+ risk with zero test coverage:
 * - ACCOUNT_INCREMENT_VIEW (public, abuse vector)
 * - GALLERY_GET_FOR_PAIRED_CLIENT (RBAC: client-only, paired access)
 * - REPORT_GALLERY_RECORD (abuse: spam reports)
 * - EMAIL_UNSUBSCRIBE (public, HMAC token)
 * - CONTACT_FORM_SUBMIT (public, rate limit)
 * - ADMIN_APPLY_STRIKE (admin destructive)
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { runHappyPathGapTests } from './happy-path-gaps.smoke';

export async function runCoverageGapTests(ctx: TestContext): Promise<void> {
  // =========================================================================
  // 1. ACCOUNT_INCREMENT_VIEW — public, POST, fire-and-forget
  // =========================================================================

  await test('INCREMENT_VIEW_HAPPY_PATH', async () => {
    const session = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const accountId = getData<{ stylist_account?: { account_id: string } }>(
      session
    )?.stylist_account?.account_id;
    if (!accountId) throw new Error('No stylist account_id from session');

    const response = await apiCall({
      endpoint: '/api/v1/account/increment-view',
      method: 'POST',
      body: { stylist_account_id: accountId },
    });
    assert.status(response, 200);
  });

  await test('INCREMENT_VIEW_MISSING_ACCOUNT_ID', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/account/increment-view',
      method: 'POST',
      body: {},
    });
    assert.status(response, 400);
  });

  await test('INCREMENT_VIEW_WRONG_METHOD', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/account/increment-view',
      method: 'GET',
    });
    if (response.status !== 400 && response.status !== 405) {
      throw new Error(`Expected 400 or 405, got ${response.status}`);
    }
  });

  // =========================================================================
  // 2. GALLERY_GET_FOR_PAIRED_CLIENT — client-only, GET
  // =========================================================================

  await test('GET_FOR_PAIRED_CLIENT_RBAC_NO_AUTH', async () => {
    const response = await apiCall({
      endpoint:
        '/api/v1/gallery/get-for-paired-client?stylist_account_id=fake-id',
    });
    assert.status(response, 401);
  });

  await test('GET_FOR_PAIRED_CLIENT_RBAC_STYLIST_DENIED', async () => {
    const response = await apiCall({
      endpoint:
        '/api/v1/gallery/get-for-paired-client?stylist_account_id=fake-id',
      token: ctx.stylistToken,
    });
    assert.status(response, 403);
  });

  await test('GET_FOR_PAIRED_CLIENT_MISSING_PARAM', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/get-for-paired-client',
      token: ctx.clientToken,
    });
    assert.status(response, 400);
  });

  // =========================================================================
  // 3. REPORT_GALLERY_RECORD — any logged-in, POST
  // =========================================================================

  await test('REPORT_GALLERY_RECORD_RBAC_NO_AUTH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/report',
      method: 'POST',
      body: { gallery_record_id: 'fake-id', reason: 'spam' },
    });
    assert.status(response, 401);
  });

  await test('REPORT_GALLERY_RECORD_INVALID_REASON', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/report',
      method: 'POST',
      token: ctx.clientToken,
      body: { gallery_record_id: 'fake-id', reason: 'INVALID_REASON' },
    });
    assert.status(response, 400);
  });

  await test('REPORT_GALLERY_RECORD_MISSING_FIELDS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/report',
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });
    assert.status(response, 400);
  });

  // =========================================================================
  // 4. EMAIL_UNSUBSCRIBE — public, GET, HMAC token
  // =========================================================================

  // NOTE: GET /email/unsubscribe is a pure 302 redirect to the branded frontend page
  // (side-effect-free human-click contract; see handler DECISION). Token VALIDATION
  // happens on POST (RFC 8058 One-Click + the frontend page). So these negative-token
  // cases are tested against POST, where the validator actually runs and returns 400.
  await test('EMAIL_UNSUBSCRIBE_MISSING_TOKEN', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/email/unsubscribe',
      method: 'POST',
      body: {},
    });
    assert.status(response, 400);
  });

  await test('EMAIL_UNSUBSCRIBE_TOKEN_TOO_SHORT', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/email/unsubscribe',
      method: 'POST',
      body: { token: 'short' },
    });
    assert.status(response, 400);
  });

  await test('EMAIL_UNSUBSCRIBE_INVALID_TOKEN', async () => {
    const fakeToken = 'a'.repeat(64);
    const response = await apiCall({
      endpoint: '/api/v1/email/unsubscribe',
      method: 'POST',
      body: { token: fakeToken },
    });
    if (response.status >= 500) {
      throw new Error(`Expected 4xx for invalid HMAC, got ${response.status}`);
    }
  });

  // =========================================================================
  // 5. CONTACT_FORM_SUBMIT — public, POST
  // =========================================================================

  await test('CONTACT_FORM_HAPPY_PATH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/public/contact-form',
      method: 'POST',
      body: {
        name: 'Smoke Test',
        topic: 'inne',
        email: `smoke-contact-${Date.now()}@example.com`,
        message: 'Automated smoke test — please ignore.',
      },
    });
    // DECISION (nie usuwaj tego komentarza):
    // 500 = admin email not configured — legalne tylko w DEVELOPMENT (brak SMTP).
    // Na STAGING/PRODUCTION email jest skonfigurowany → 500 = realna regresja.
    // Tolerujemy 500 tylko gdy NODE_ENV_MANUAL=DEVELOPMENT (test runner env).
    const isDev = process.env.NODE_ENV_MANUAL === 'DEVELOPMENT';
    if (isDev && response.status === 500) return; // Known dev limitation: admin email not configured
    if (response.status !== 200) {
      throw new Error(
        `Expected 200${isDev ? ' (or 500 in DEVELOPMENT — admin email not configured)' : ''}, got ${response.status}`
      );
    }
  });

  await test('CONTACT_FORM_INVALID_TOPIC', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/public/contact-form',
      method: 'POST',
      body: {
        name: 'Test',
        topic: 'INVALID_TOPIC',
        email: 'test@example.com',
        message: 'Test message.',
      },
    });
    assert.status(response, 400);
  });

  await test('CONTACT_FORM_MISSING_FIELDS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/public/contact-form',
      method: 'POST',
      body: { name: 'Test' },
    });
    assert.status(response, 400);
  });

  await test('CONTACT_FORM_INVALID_EMAIL', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/public/contact-form',
      method: 'POST',
      body: {
        name: 'Test',
        topic: 'inne',
        email: 'not-an-email',
        message: 'Test message.',
      },
    });
    assert.status(response, 400);
  });

  // =========================================================================
  // 6. ADMIN_APPLY_STRIKE — admin-only, POST
  // =========================================================================

  await test('APPLY_STRIKE_RBAC_NO_AUTH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/moderation/apply-strike',
      method: 'POST',
      body: { user_id: 'fake', reason: 'test', report_id: 'fake' },
    });
    assert.status(response, 401);
  });

  await test('APPLY_STRIKE_RBAC_STYLIST_DENIED', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/moderation/apply-strike',
      method: 'POST',
      token: ctx.stylistToken,
      body: { user_id: 'fake', reason: 'test', report_id: 'fake' },
    });
    assert.status(response, 403);
  });

  await test('APPLY_STRIKE_RBAC_CLIENT_DENIED', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/moderation/apply-strike',
      method: 'POST',
      token: ctx.clientToken,
      body: { user_id: 'fake', reason: 'test', report_id: 'fake' },
    });
    assert.status(response, 403);
  });

  await test('APPLY_STRIKE_MISSING_FIELDS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/admin/moderation/apply-strike',
      method: 'POST',
      token: ctx.adminToken,
      body: {},
    });
    assert.status(response, 400);
  });

  // Happy-path counterparts for the endpoints above (and the rest of the
  // negative-only set). Chained from here rather than from run-smoke-tests.ts so
  // the whole gap-closing effort keeps one entry point.
  await runHappyPathGapTests(ctx);
}

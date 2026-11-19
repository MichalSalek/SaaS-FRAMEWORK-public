/**
 * User domain contract smoke tests
 *
 * Contract tests for user endpoints not covered by existing smoke tests.
 * Tests auth (401) and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - USER_CHANGE_EMAIL (auth + validation — destructive action skipped, contract only)
 * - USER_UPDATE_NOTIFICATION_PREFERENCES (auth + validation)
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runUserContractTests(ctx: TestContext): Promise<void> {
  // ── USER_CHANGE_EMAIL ──

  await test('CHANGE_EMAIL_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/user/change-email',
      method: 'POST',
      body: { email: 'test@example.com' },
    });
    assert.status(res, 401);
  });

  await test('CHANGE_EMAIL_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/user/change-email',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('CHANGE_EMAIL_VALIDATES_FORMAT', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/user/change-email',
      method: 'POST',
      token: ctx.stylistToken,
      body: { email: 'not-an-email' },
    });
    assert.status(res, 400);
  });

  // ── USER_UPDATE_NOTIFICATION_PREFERENCES ──

  await test('UPDATE_NOTIFICATION_PREFS_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/user/update-notification-preferences',
      method: 'POST',
      body: { notifications_enabled: true },
    });
    assert.status(res, 401);
  });

  await test('UPDATE_NOTIFICATION_PREFS_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/user/update-notification-preferences',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('UPDATE_NOTIFICATION_PREFS_REJECTS_NON_BOOLEAN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/user/update-notification-preferences',
      method: 'POST',
      token: ctx.stylistToken,
      body: { notifications_enabled: 'yes' },
    });
    assert.status(res, 400);
  });
}

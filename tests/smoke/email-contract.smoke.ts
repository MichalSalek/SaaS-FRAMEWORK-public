/**
 * Email domain contract smoke tests
 *
 * Contract tests for email endpoints not covered by existing smoke tests.
 * Tests auth (401) and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - EMAIL_UPDATE_PREFERENCES (auth + validation)
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runEmailContractTests(ctx: TestContext): Promise<void> {
  // ── EMAIL_UPDATE_PREFERENCES ──

  await test('EMAIL_UPDATE_PREFERENCES_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/email/update-preferences',
      method: 'POST',
      body: { trial_sequence: true, marketing: false },
    });
    assert.status(res, 401);
  });

  await test('EMAIL_UPDATE_PREFERENCES_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/email/update-preferences',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('EMAIL_UPDATE_PREFERENCES_REJECTS_NON_BOOLEAN', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/email/update-preferences',
      method: 'POST',
      token: ctx.stylistToken,
      body: { trial_sequence: 'yes', marketing: 1 },
    });
    assert.status(res, 400);
  });
}

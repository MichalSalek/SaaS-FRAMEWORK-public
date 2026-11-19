/**
 * Account domain contract smoke tests
 *
 * Contract tests for account endpoints not covered by existing smoke tests.
 * Tests auth (401) and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - ACCOUNT_SET_DASHBOARD_NOTE (auth + validation)
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runAccountContractTests(ctx: TestContext): Promise<void> {
  // ── ACCOUNT_SET_DASHBOARD_NOTE ──

  await test('SET_DASHBOARD_NOTE_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/account/set-dashboard-note',
      method: 'POST',
      body: { account_type: 'STYLIST', note: 'test note' },
    });
    assert.status(res, 401);
  });

  await test('SET_DASHBOARD_NOTE_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/account/set-dashboard-note',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('SET_DASHBOARD_NOTE_REJECTS_INVALID_ACCOUNT_TYPE', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/account/set-dashboard-note',
      method: 'POST',
      token: ctx.stylistToken,
      body: { account_type: 'INVALID_TYPE', note: 'test' },
    });
    assert.status(res, 400);
  });
}

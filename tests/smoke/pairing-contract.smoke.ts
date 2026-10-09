/**
 * Pairing domain contract smoke tests
 *
 * Contract tests for pairing endpoints not covered by existing smoke tests.
 * Tests auth (401), RBAC (403), and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - PAIRING_SESSION_REVOKE (auth + RBAC + validation)
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runPairingContractTests(ctx: TestContext): Promise<void> {
  // ── PAIRING_SESSION_REVOKE ──

  await test('PAIRING_REVOKE_SESSION_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/pairing/revoke-session',
      method: 'POST',
      body: { token: 'fake_token_value' },
    });
    assert.status(res, 401);
  });

  await test('PAIRING_REVOKE_SESSION_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/pairing/revoke-session',
      method: 'POST',
      token: ctx.clientToken,
      body: { token: 'fake_token_value' },
    });
    assert.status(res, 403);
  });

  await test('PAIRING_REVOKE_SESSION_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/pairing/revoke-session',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });
}

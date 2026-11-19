/**
 * Exchange-code smoke tests: variant C token bridge contract.
 *
 * Covers: missing body, garbage code, empty authCode (opaque 404), wrong method (406).
 *
 * The full flow with a real code runs in `npm run test:prod` (magic link read over IMAP, tests/prod/);
 * these smokes stay on the negative contract (404/406), which needs no session. A valid `authCode` is
 * minted inside Better Auth's `hooks.after` for `/magic-link/verify` and OAuth callbacks, so no
 * standalone HTTP call can mint one. Full flow:
 *   1. POST /api/auth/sign-in/magic-link { email } -> 200
 *   2. Read the raw magic-link token from the DB (no internal mint endpoint exists)
 *   3. GET /api/auth/magic-link/verify?token=<raw>&callbackURL=/app -> 302 to <FRONTEND>?authCode=<code>
 *   4. POST /api/auth/exchange-code { authCode } -> 200 with a bearer token in `authorization`
 *   5. Replay the same authCode -> 404
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runExchangeCodeTests(_ctx: TestContext): Promise<void> {
  // =========================================================================
  // HTTP CONTRACT — no auth required (pre-auth endpoint)
  // =========================================================================

  await test('EXCHANGE_CODE_MISSING_BODY', async () => {
    // Empty body: authCode field absent → same opaque 404 as unknown code.
    // Endpoint normalises absent field to '' and takes the early-exit guard.
    const response = await apiCall({
      endpoint: '/api/auth/exchange-code',
      method: 'POST',
      body: {},
    });
    assert.status(response, 404);
  });

  await test('EXCHANGE_CODE_EMPTY_STRING', async () => {
    // authCode present but empty string → hits same early-exit guard as absent.
    const response = await apiCall({
      endpoint: '/api/auth/exchange-code',
      method: 'POST',
      body: { authCode: '' },
    });
    assert.status(response, 404);
  });

  await test('EXCHANGE_CODE_INVALID_CODE', async () => {
    // 64 hex chars (valid format, but no matching DB row) → 404 opaque.
    // Endpoint MUST NOT distinguish "unknown" from "expired" (anti-enumeration).
    const fakeCode = 'a'.repeat(64);
    const response = await apiCall({
      endpoint: '/api/auth/exchange-code',
      method: 'POST',
      body: { authCode: fakeCode },
    });
    assert.status(response, 404);
  });

  await test('EXCHANGE_CODE_NON_HEX_GARBAGE', async () => {
    // Non-hex string — should still return 404, not 400/500 (no input validation
    // beyond "non-empty string"; lookup simply finds nothing).
    const response = await apiCall({
      endpoint: '/api/auth/exchange-code',
      method: 'POST',
      body: { authCode: 'not-a-valid-code-🔑' },
    });
    assert.status(response, 404);
  });

  await test('EXCHANGE_CODE_WRONG_METHOD_GET', async () => {
    // GET is rejected — endpoint is POST-only (method guard returns 406).
    const response = await apiCall({
      endpoint: '/api/auth/exchange-code',
      method: 'GET',
    });
    // 406 Not Acceptable (the project convention for wrong-method / not-allowed).
    assert.status(response, 406);
  });

  // =========================================================================
  // OWNER-RUNTIME — SKIPPED (require dev-server + DB)
  // =========================================================================

  await test('EXCHANGE_CODE_VALID_FLOW__OWNER_RUNTIME_SKIP', async () => {
    // SKIP: obtaining a valid authCode requires the full magic-link verify
    // flow (dev-server + DB access). See file header for the manual recipe.
    // When a dev-only `/api/auth/dev-mint-exchange-code` endpoint is added,
    // replace this skip with:
    //   const mintResp = await apiCall({ endpoint: '/api/auth/dev-mint-exchange-code',
    //     method: 'POST', headers: { 'x-internal-secret': TEST_CONFIG.INTERNAL_SECRET },
    //     body: { sessionToken: ctx.stylistToken } });
    //   const { code } = getData<{ code: string }>(mintResp);
    //   const exchangeResp = await apiCall({ endpoint: '/api/auth/exchange-code',
    //     method: 'POST', body: { authCode: code } });
    //   assert.status(exchangeResp, 200);
    //   const bearerToken = exchangeResp.headers['authorization'];
    //   assert.equals(typeof bearerToken, 'string', 'must have authorization header');
    console.log(
      '   [SKIP] EXCHANGE_CODE_VALID_FLOW: requires dev-server + DB mint. See file header.'
    );
  });

  await test('EXCHANGE_CODE_REPLAY__OWNER_RUNTIME_SKIP', async () => {
    // SKIP: burn-on-first-redeem regression — replay of a used code must 404.
    // Requires a valid code (same constraint as VALID_FLOW above).
    console.log(
      '   [SKIP] EXCHANGE_CODE_REPLAY: requires dev-server + DB mint. See file header.'
    );
  });
}

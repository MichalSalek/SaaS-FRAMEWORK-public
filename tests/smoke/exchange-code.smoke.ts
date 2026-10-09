/**
 * Exchange-code smoke tests — variant C token bridge contract.
 *
 * Covers:
 *   - EXCHANGE_CODE_MISSING_BODY    (no authCode in body → 404, opaque)
 *   - EXCHANGE_CODE_INVALID_CODE    (unknown/garbage code → 404, opaque)
 *   - EXCHANGE_CODE_WRONG_METHOD    (GET → 406, method guard)
 *   - EXCHANGE_CODE_EMPTY_STRING    (authCode: "" → 404, early-exit guard)
 *   - EXCHANGE_CODE_VALID_FLOW      (SKIPPED — owner-runtime only, see note below)
 *   - EXCHANGE_CODE_REPLAY          (SKIPPED — owner-runtime only)
 *
 * ZAUTOMATYZOWANE (2026-08-18): pełny przebieg z prawdziwym kodem wymiany
 * przechodzi teraz `npm run test:prod` — suita prosi o magic-link i odbiera go ze
 * skrzynki testowej po IMAP (tests/prod/, README tamże), więc kroki 1-6 poniżej
 * nie wymagają już ręcznego klikania ani dev-only endpointu do mintowania kodu.
 * Te smoke'y zostają przy kontrakcie negatywnym (404/406), który da się sprawdzić
 * bez sesji.
 *
 * OWNER-RUNTIME NOTE (valid-code tests):
 *   A valid `authCode` is minted inside Better Auth's `hooks.after` for
 *   `/magic-link/verify` and OAuth callbacks — it is NOT directly mintable
 *   via a standalone HTTP call. To obtain one you must run the full flow:
 *
 *     1. POST /api/auth/sign-in/magic-link  { email }
 *        → 200, Verification row written to DB
 *     2. Read the raw magic-link token from DB (e.g. via `npm run db:studio`
 *        or a direct Prisma query in the dev environment)
 *     3. GET /api/auth/magic-link/verify?token=<raw>&callbackURL=/app
 *        → 302 redirect to <FRONTEND>?authCode=<code>
 *     4. Extract `authCode` from the redirect Location header
 *     5. POST /api/auth/exchange-code { authCode }
 *        → 200, `authorization` response header = bearer token
 *     6. Replay same authCode → 404 (burned on first redeem)
 *
 *   This requires a running backend + DB and cannot be driven from pure HTTP
 *   calls (step 2 needs DB access or an internal mint endpoint that does not
 *   exist for security reasons).
 *
 *   Run these manually after step 3-4 in a dev environment, or add a
 *   dedicated dev-only `/api/auth/dev-mint-exchange-code` endpoint that
 *   wraps `mintExchangeCode` behind `IS_DEVELOPMENT_ENV()` + the existing
 *   `INTERNAL_SHARED_SECRET` gate — then the full smoke flow becomes:
 *     a. getDevLoginToken() to get a session token
 *     b. POST /api/auth/dev-mint-exchange-code { sessionToken } → { code }
 *     c. POST /api/auth/exchange-code { authCode: code } → 200 + auth header
 *     d. Replay same code → 404
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

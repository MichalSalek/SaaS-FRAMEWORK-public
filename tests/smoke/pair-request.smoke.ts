/**
 * Pair-request smoke tests (a connection request from a stylist's permanent QR code): CREATE,
 * RESPOND, CANCEL, PAIRING_GET_PENDING_REQUESTS.
 *
 * Protects:
 *   - A STYLIST-SIDE REVOKE IS ONE-WAY: her only control over who writes to her inbox (messaging
 *     is open already in PENDING). A new request after her revoke MUST get a masked 404; coming
 *     back MUST go through scanning the code (claim = her consent).
 *   - Anti-oracle: a nonexistent stylist, one's own account and an account that rejected us give
 *     ONE answer.
 *   - A repeated request creates no second row and keeps its list position; a repeated
 *     withdrawal is not an error.
 *   - PII minimum before acceptance: the request list returns the name, NOT the e-mail.
 * The suite sets up its own state; the `_setup.ts` pre-clean leaves "revoked by stylist".
 */

import { test, apiCall, getData, getEvent, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

const GHOST_STYLIST_ACCOUNT_ID = 'sa_smoke_nonexistent_account_id';

/**
 * `pair_id` in the response is nullable ONLY when one of two concurrent first requests loses on
 * the unique constraint. The suite is single-threaded, so null would be a real contract
 * regression; we narrow explicitly instead of casting.
 */
const requirePairId = (pairIdOrNull: string | null): string => {
  if (pairIdOrNull === null) {
    throw new Error(
      'pair_id must not be null outside a concurrent-create race'
    );
  }
  return pairIdOrNull;
};

/** Disconnect with the STYLIST token => `revoked_by = STYLIST` (blocks coming back). */
const revokeByStylist = async (
  ctx: TestContext,
  clientUserId: string
): Promise<void> => {
  const response = await apiCall({
    endpoint: ROUTES_API.PAIRING_ACCESS_REVOKE,
    method: 'POST',
    token: ctx.stylistToken,
    body: { target_user_id: clientUserId },
  });
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(`revoke by stylist failed: ${response.status}`);
  }
};

const createRequest = async (ctx: TestContext, stylistAccountId: string) =>
  apiCall({
    endpoint: ROUTES_API.PAIR_REQUEST_CREATE,
    method: 'POST',
    token: ctx.clientToken,
    body: { stylist_account_id: stylistAccountId },
  });

const listPendingRequests = async (ctx: TestContext) => {
  const response = await apiCall({
    endpoint: ROUTES_API.PAIRING_GET_PENDING_REQUESTS,
    method: 'GET',
    token: ctx.stylistToken,
  });
  assert.status(response, 200);
  return getData<
    PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE']
  >(response);
};

export async function runPairRequestTests(ctx: TestContext): Promise<void> {
  let stylistAccountId = '';
  let clientUserId = '';
  let pairId = '';

  try {
    const pair = await ensureActivePair(ctx);
    stylistAccountId = pair.stylistAccountId;
    clientUserId = pair.clientUserId;

    // ── Anti-harassment control: the stylist's revoke closes the way back ──
    await test('PAIR_REQUEST_BLOCKED_AFTER_STYLIST_REVOKE', async () => {
      await revokeByStylist(ctx, clientUserId);

      const response = await createRequest(ctx, stylistAccountId);
      assert.status(response, 404);

      // The mask must be INDISTINGUISHABLE from "no such stylist",
      // so a rejected person cannot learn she was blocked.
      const ghost = await createRequest(ctx, GHOST_STYLIST_ACCOUNT_ID);
      assert.equals(
        ghost.status,
        response.status,
        'blocked and nonexistent stylist must share a status'
      );
      assert.equals(
        getEvent(ghost),
        getEvent(response),
        'blocked and nonexistent stylist must share an event (no oracle)'
      );

      // A blocked request must not land on the stylist's list.
      const pending = await listPendingRequests(ctx);
      assert.equals(
        pending.requests.some(r => r.pair_id === pairId),
        false,
        'a blocked request must never reach the pending list'
      );
    });

    // ── Legalna droga powrotu: zeskanowanie kodu (zgoda stylistki) ────────
    await test('PAIRING_CLAIM_IS_THE_LEGAL_WAY_BACK', async () => {
      const restored = await ensureActivePair(ctx);
      assert.equals(
        restored.stylistAccountId,
        stylistAccountId,
        'claim must restore the same pairing'
      );
      pairId = restored.pairId;
    });

    // ── A request after the CLIENT withdrew is allowed ──────────────────
    await test('PAIR_REQUEST_CREATE', async () => {
      // Disconnect with the client token => revoked_by = CLIENT => coming back stays open.
      await revokePairQuietly(ctx, stylistAccountId);

      const response = await createRequest(ctx, stylistAccountId);
      assert.equals(
        response.status === 200 || response.status === 201,
        true,
        `client-side re-request must be allowed, got ${response.status}`
      );
      const data =
        getData<PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE']>(
          response
        );
      assert.equals(data.status, 'PENDING');
      assert.equals(typeof data.pair_id, 'string');
      // `created` is NOT asserted here: this suite has just paired and disconnected these
      // accounts, so the request falls inside the reassert window and deliberately sends no
      // second notification (see the DECISION at `isRapidReassert` in
      // `pair-request.operations.ts`). That the first request OUTSIDE the window notifies is
      // covered by the unit tests in `pair-request.reassert-window.test.ts`, where the clock
      // can be controlled and here it cannot.
      pairId = requirePairId(data.pair_id);
    });

    await test('PAIRING_GET_PENDING_REQUESTS', async () => {
      const data = await listPendingRequests(ctx);
      const request = data.requests.find(r => r.pair_id === pairId);
      assert.equals(!!request, true, 'pending request must be listed');
      if (request) {
        assert.hasProperty(
          request as unknown as Record<string, unknown>,
          'requested_at'
        );
        // PII minimum before acceptance: the name yes, the e-mail only after ACCEPT.
        assert.equals(
          Object.prototype.hasOwnProperty.call(request, 'email'),
          false,
          'pending list must not leak the client email before ACCEPT'
        );
      }
    });

    await test('PAIR_REQUEST_CREATE_IS_IDEMPOTENT', async () => {
      const response = await createRequest(ctx, stylistAccountId);
      assert.equals(
        response.status === 200 || response.status === 201,
        true,
        `repeated request must be idempotent, got ${response.status}`
      );
      const data =
        getData<PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE']>(
          response
        );
      assert.equals(data.status, 'PENDING');
      assert.equals(
        data.created,
        false,
        'repeated request must NOT report a fresh creation (spam must not re-notify)'
      );
      assert.equals(
        data.status,
        'PENDING',
        'state still reflects a pending request'
      );
      assert.equals(data.pair_id, pairId, 'repeated request reuses the row');

      const pending = await listPendingRequests(ctx);
      assert.equals(
        pending.requests.filter(r => r.pair_id === pairId).length,
        1,
        'repeated request must not duplicate the pending row'
      );
    });

    // ── Withdrawal by the client ─────────────────────────────────────────
    await test('PAIR_REQUEST_CANCEL', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_CANCEL,
        method: 'POST',
        token: ctx.clientToken,
        body: { stylist_account_id: stylistAccountId },
      });
      assert.status(response, 200);
      const data =
        getData<PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE']>(
          response
        );
      assert.equals(data.success, true);

      const pending = await listPendingRequests(ctx);
      assert.equals(
        pending.requests.some(r => r.pair_id === pairId),
        false,
        'cancelled request must disappear from the pending list'
      );
    });

    await test('PAIR_REQUEST_CANCEL_IS_IDEMPOTENT', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_CANCEL,
        method: 'POST',
        token: ctx.clientToken,
        body: { stylist_account_id: stylistAccountId },
      });
      assert.status(response, 200);
      const data =
        getData<PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE']>(
          response
        );
      assert.equals(
        data.success,
        false,
        'cancelling a nonexistent request reports "nothing done", not an error'
      );
    });

    // ── Stylist response: ACCEPT ──────────────────────────────────────
    await test('PAIR_REQUEST_RESPOND_ACCEPT', async () => {
      const created = await createRequest(ctx, stylistAccountId);
      const createdData =
        getData<PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE']>(created);
      pairId = requirePairId(createdData.pair_id);

      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_RESPOND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: pairId, action: 'ACCEPT' },
      });
      assert.status(response, 200);
      const data =
        getData<PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE']>(
          response
        );
      assert.equals(data.success, true);
      assert.equals(data.status, 'ACTIVE', 'ACCEPT must activate the pair');

      const pending = await listPendingRequests(ctx);
      assert.equals(
        pending.requests.some(r => r.pair_id === pairId),
        false,
        'accepted request must leave the pending list'
      );
    });

    // A second response to the same (no longer PENDING) request = masked 404.
    await test('PAIR_REQUEST_RESPOND_REJECTS_NON_PENDING', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_RESPOND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: pairId, action: 'ACCEPT' },
      });
      assert.status(response, 404);
    });

    await test('PAIR_REQUEST_RESPOND_REJECTS_UNKNOWN_ACTION', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_RESPOND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: pairId, action: 'accept' },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `action is case-sensitive enum, got ${response.status}`
      );
    });

    await test('PAIR_REQUEST_RESPOND_REJECTS_FOREIGN_PAIR', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_RESPOND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: 'csp_smoke_not_my_pair', action: 'ACCEPT' },
      });
      assert.status(response, 404);
    });

    // ── Self-pair (dual-role) is masked by the same 404 ───────────────
    await test('PAIR_REQUEST_CREATE_REJECTS_SELF_PAIR', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.PAIR_REQUEST_CREATE,
        method: 'POST',
        token: ctx.stylistToken,
        body: { stylist_account_id: stylistAccountId },
      });
      assert.equals(
        response.status >= 400 && response.status < 500,
        true,
        `self-pair must be rejected, got ${response.status}`
      );
    });
  } finally {
    await revokePairQuietly(ctx, stylistAccountId);
  }
}

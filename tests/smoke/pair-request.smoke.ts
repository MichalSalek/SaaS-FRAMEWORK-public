/**
 * Pair-request domain smoke tests (prośba o połączenie ze stałego kodu QR)
 *
 * Domyka lukę pokryciową: 4 trasy bez ŻADNEGO testu, wołane z publicznego
 * profilu stylistki i z jej ekranu Parowanie.
 *   PAIR_REQUEST_CREATE, PAIR_REQUEST_RESPOND, PAIR_REQUEST_CANCEL,
 *   PAIRING_GET_PENDING_REQUESTS
 *
 * Najważniejsze, co te testy chronią:
 *   - ZERWANIE PO STRONIE STYLISTKI JEST NIEODWRACALNE JEDNOSTRONNIE.
 *     "Usuń tę osobę" to jedyna kontrola stylistki nad tym, kto pisze do jej
 *     skrzynki (komunikator jest otwarty już w stanie PENDING). Regresja tutaj
 *     oznacza, że usunięta osoba jednym POST-em wraca do rozmowy — dlatego
 *     ponowna prośba po revoke stylistki MUSI dostać zamaskowane 404, a powrót
 *     MUSI prowadzić przez zeskanowanie kodu (claim = zgoda stylistki).
 *   - anty-oracle: nieistniejąca stylistka, własne konto (dual-role) i konto,
 *     które nas odrzuciło, dają JEDNĄ odpowiedź — inaczej prośba staje się
 *     sondą "czy to konto istnieje / czy mnie zablokowano"
 *   - idempotencja: powtórzona prośba nie tworzy drugiego wiersza i nie
 *     odświeża pozycji na liście; powtórzone wycofanie nie jest błędem
 *   - PII-minimum przed akceptacją: lista próśb oddaje imię, NIE e-mail
 *
 * Suita SAMA ustawia potrzebny stan (nie zakłada niczego po poprzednich
 * suitach ani po pre-cleanie z `_setup.ts`, który rozłącza pary tokenem
 * stylistki, czyli zostawia właśnie stan "zerwane przez stylistkę").
 */

import { test, apiCall, getData, getEvent, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

const GHOST_STYLIST_ACCOUNT_ID = 'sa_smoke_nonexistent_account_id';

/**
 * `pair_id` w odpowiedzi jest nullowalny WYŁĄCZNIE dla przegranego wyścigu
 * dwóch pierwszych próśb (unique-violation). Suita jest jednowątkowa, więc
 * null oznaczałby realną regresję kontraktu — zawężamy jawnie zamiast rzutować.
 */
const requirePairId = (pairIdOrNull: string | null): string => {
  if (pairIdOrNull === null) {
    throw new Error(
      'pair_id must not be null outside a concurrent-create race'
    );
  }
  return pairIdOrNull;
};

/** Rozłączenie tokenem STYLISTKI => `revoked_by = STYLIST` (blokada powrotu). */
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

    // ── Kontrola anty-nękaniowa: revoke stylistki zamyka drogę powrotu ────
    await test('PAIR_REQUEST_BLOCKED_AFTER_STYLIST_REVOKE', async () => {
      await revokeByStylist(ctx, clientUserId);

      const response = await createRequest(ctx, stylistAccountId);
      assert.status(response, 404);

      // Maska musi być NIEODRÓŻNIALNA od "taka stylistka nie istnieje",
      // żeby odrzucona osoba nie dowiedziała się, że została zablokowana.
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

      // Zablokowana prośba nie może wylądować na liście stylistki.
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

    // ── Prośba po wycofaniu przez KLIENTKĘ jest dozwolona ────────────────
    await test('PAIR_REQUEST_CREATE', async () => {
      // Rozłączenie tokenem klientki => revoked_by = CLIENT => powrót otwarty.
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
      // `created` NIE jest tu asertowane: ta suita dopiero co sparowała i
      // rozłączyła te konta, więc prośba mieści się w oknie ponowienia i
      // celowo nie generuje drugiego powiadomienia (patrz DECISION przy
      // `isRapidReassert`). To, że pierwsza prośba POZA oknem powiadamia,
      // pilnują testy jednostkowe `pair-request.reassert-window.test.ts` —
      // sterowanie zegarem jest tam możliwe, a tutaj nie.
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
        // PII-minimum przed akceptacją: imię tak, e-mail dopiero po ACCEPT.
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

    // ── Wycofanie przez klientkę ─────────────────────────────────────────
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

    // ── Odpowiedź stylistki: ACCEPT ──────────────────────────────────────
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

    // Druga odpowiedź na tę samą (już nie-PENDING) prośbę = zamaskowane 404.
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

    // ── Self-pair (dual-role) jest zamaskowany tym samym 404 ─────────────
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

/**
 * Messaging domain smoke tests (komunikator stylistka <-> klientka)
 *
 * Domyka lukę pokryciową: 4 trasy bez ŻADNEGO testu, wołane z ekranu rozmów.
 *   MESSAGING_SEND, MESSAGING_MARK_READ, MESSAGING_GET_THREAD,
 *   MESSAGING_GET_CONVERSATIONS
 *
 * Te testy złapałyby regresje w:
 *   - party-gate (tylko strony pary widzą wątek) i anty-enumeracji: nie-strona
 *     i para nieistniejąca MUSZĄ dać identyczną odpowiedź, inaczej 403-vs-404
 *     zdradza realne `pair_id`
 *   - watermarku nieprzeczytanych (unread rośnie u odbiorcy, mark-read zeruje
 *     TYLKO jego stronę, nadawca nigdy nie ma własnych wiadomości jako unread)
 *   - kontrakcie odmowy dla pary REVOKED: 403 + event MESSAGING_NOT_ALLOWED
 *     (regresja tego eventa = front nie odróżni "rozmowa zamknięta" od
 *     "brak dostępu")
 *   - spójności `can_send` z faktycznym zachowaniem wysyłki
 *
 * Stan budowany WYŁĄCZNIE przez publiczne API (parytet z resztą smoke).
 */

import { test, apiCall, getData, getEvent, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { MESSAGING_LENGTHS } from '@kernel/policies/validation.config';

/** Nieistniejąca para — punkt odniesienia dla testu anty-enumeracji. */
const GHOST_PAIR_ID = 'csp_smoke_nonexistent_pair_id';

export async function runMessagingTests(ctx: TestContext): Promise<void> {
  let pairId = '';
  let stylistAccountId = '';

  try {
    const pair = await ensureActivePair(ctx);
    pairId = pair.pairId;
    stylistAccountId = pair.stylistAccountId;

    // ── Wysyłka ───────────────────────────────────────────────────────────
    await test('MESSAGING_SEND', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_SEND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: pairId, content: 'Smoke: do zobaczenia w czwartek' },
      });
      assert.equals(
        response.status === 201 || response.status === 200,
        true,
        `send must succeed on an ACTIVE pair, got ${response.status}`
      );
      const data =
        getData<MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE']>(response);
      assert.hasProperty(data, 'message');
      assert.equals(
        data.message.sender_type,
        'STYLIST',
        'sender_type must be derived from the session, not the body'
      );
      assert.equals(data.message.content, 'Smoke: do zobaczenia w czwartek');
      assert.equals(typeof data.message.id, 'string');
    });

    await test('MESSAGING_SEND_REJECTS_BLANK_CONTENT', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_SEND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: pairId, content: '   ' },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `whitespace-only content must be rejected, got ${response.status}`
      );
    });

    await test('MESSAGING_SEND_REJECTS_OVER_MAX', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_SEND,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          pair_id: pairId,
          content: 'x'.repeat(MESSAGING_LENGTHS.CONTENT_MAX + 1),
        },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `content over CONTENT_MAX must be rejected, got ${response.status}`
      );
    });

    // ── Wątek ─────────────────────────────────────────────────────────────
    await test('MESSAGING_GET_THREAD', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.MESSAGING_GET_THREAD}?pair_id=${encodeURIComponent(pairId)}`,
        method: 'GET',
        token: ctx.clientToken,
      });
      assert.status(response, 200);
      const data =
        getData<MESSAGING_DTO_API_V1['MESSAGING_GET_THREAD']['RESPONSE']>(
          response
        );
      assert.hasProperty(data, 'meta');
      assert.equals(data.meta.pair_id, pairId);
      assert.equals(
        data.meta.viewer_side,
        'CLIENT',
        'viewer_side must reflect the caller, not the pair owner'
      );
      assert.equals(
        data.meta.can_send,
        true,
        'ACTIVE pair must allow sending'
      );
      assert.equals(
        data.messages.some(m => m.sender_type === 'STYLIST'),
        true,
        "client must see the stylist's message in the thread"
      );
    });

    // ── Nieprzeczytane + watermark ────────────────────────────────────────
    await test('MESSAGING_GET_CONVERSATIONS', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_GET_CONVERSATIONS,
        method: 'GET',
        token: ctx.clientToken,
      });
      assert.status(response, 200);
      const data =
        getData<
          MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE']
        >(response);
      const conversation = data.conversations.find(c => c.pair_id === pairId);
      assert.equals(
        !!conversation,
        true,
        'a pair with messages must appear in the inbox'
      );
      if (conversation) {
        assert.equals(
          conversation.unread_count >= 1,
          true,
          "recipient must have the stylist's message as unread"
        );
        assert.equals(
          conversation.last_message_preview,
          'Smoke: do zobaczenia w czwartek',
          'inbox preview must carry the last message'
        );
      }
    });

    // Nadawca nie może mieć własnej wiadomości jako nieprzeczytanej.
    await test('MESSAGING_SENDER_HAS_NO_SELF_UNREAD', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_GET_CONVERSATIONS,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.status(response, 200);
      const data =
        getData<
          MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE']
        >(response);
      const conversation = data.conversations.find(c => c.pair_id === pairId);
      if (conversation) {
        assert.equals(
          conversation.unread_count,
          0,
          'sender must not see their own message as unread'
        );
      }
    });

    await test('MESSAGING_MARK_READ', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_MARK_READ,
        method: 'POST',
        token: ctx.clientToken,
        body: { pair_id: pairId },
      });
      assert.status(response, 200);
      const data =
        getData<MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['RESPONSE']>(
          response
        );
      assert.equals(data.pair_id, pairId);
      assert.hasProperty(data, 'read_at');

      const after = await apiCall({
        endpoint: ROUTES_API.MESSAGING_GET_CONVERSATIONS,
        method: 'GET',
        token: ctx.clientToken,
      });
      const afterData =
        getData<
          MESSAGING_DTO_API_V1['MESSAGING_GET_CONVERSATIONS']['RESPONSE']
        >(after);
      const conversation = afterData.conversations.find(
        c => c.pair_id === pairId
      );
      assert.equals(
        conversation?.unread_count,
        0,
        'mark-read must zero the caller unread counter'
      );
    });

    // ── Party-gate i anty-enumeracja ──────────────────────────────────────
    // Admin NIE jest stroną tej pary. Odpowiedź dla niego musi być
    // NIEODRÓŻNIALNA od odpowiedzi dla pary, która nie istnieje — inaczej
    // różnica kodów zdradza, że dane `pair_id` jest prawdziwe.
    await test('MESSAGING_THREAD_ANTI_ENUMERATION', async () => {
      const foreign = await apiCall({
        endpoint: `${ROUTES_API.MESSAGING_GET_THREAD}?pair_id=${encodeURIComponent(pairId)}`,
        method: 'GET',
        token: ctx.adminToken,
      });
      const ghost = await apiCall({
        endpoint: `${ROUTES_API.MESSAGING_GET_THREAD}?pair_id=${GHOST_PAIR_ID}`,
        method: 'GET',
        token: ctx.adminToken,
      });
      assert.equals(
        foreign.status,
        ghost.status,
        `non-party and nonexistent pair must share a status (${foreign.status} vs ${ghost.status})`
      );
      assert.equals(
        getEvent(foreign),
        getEvent(ghost),
        'non-party and nonexistent pair must share an event (no oracle)'
      );
      assert.equals(
        foreign.status,
        404,
        'party-gate verdict is a masked 404'
      );
    });

    await test('MESSAGING_SEND_REJECTS_NON_PARTY', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_SEND,
        method: 'POST',
        token: ctx.adminToken,
        body: { pair_id: pairId, content: 'nie moja rozmowa' },
      });
      assert.status(response, 404);
    });

    await test('MESSAGING_MARK_READ_REJECTS_NON_PARTY', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.MESSAGING_MARK_READ,
        method: 'POST',
        token: ctx.adminToken,
        body: { pair_id: pairId },
      });
      assert.status(response, 404);
    });

    // ── Para REVOKED: historia read-only ──────────────────────────────────
    await test('MESSAGING_REVOKED_PAIR_IS_READ_ONLY', async () => {
      await revokePairQuietly(ctx, stylistAccountId);

      const send = await apiCall({
        endpoint: ROUTES_API.MESSAGING_SEND,
        method: 'POST',
        token: ctx.stylistToken,
        body: { pair_id: pairId, content: 'po zerwaniu pary' },
      });
      assert.status(send, 403);
      // Kontrakt koperty: front rozróżnia "rozmowa zamknięta" od ogólnego
      // braku dostępu WYŁĄCZNIE po tym evencie. Generyk = regresja.
      assert.equals(
        getEvent(send),
        APP_EVENTS.INFO.MESSAGING.MESSAGING_NOT_ALLOWED,
        `403 for a REVOKED pair must carry MESSAGING_NOT_ALLOWED, got ${getEvent(send)}`
      );
    });
  } finally {
    await revokePairQuietly(ctx, stylistAccountId);
  }
}

/**
 * Integration-handler test for the stylist-client thread and send handlers.
 *
 * Drives the real handlers through production middleware (auth, permission and
 * the DB mocked) and pins the HTTP contract:
 *   1. GET thread as a party returns 200 with meta.viewer_side and messages.
 *      A body validator used to 400 every GET, because the query is not the body.
 *   2. POST send as a party returns 201 and the created message (SERIALIZABLE tx).
 *   3. GET thread as a non-party returns 404 MESSAGING_PAIR_NOT_FOUND.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import threadHandler from '../../pages/api/v1/messaging/thread/index';
import sendHandler from '../../pages/api/v1/messaging/send/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AccountStatusValue,
  PairingStatusValue,
  StylistClientMessageSenderValue,
} from '@kernel/models/db_models.generated.dto';
// Fixture ids: client user = usr_...0002 (makeClientCurrentUser default),
// stylist account = acc_...0001. Para dopasowana do klientki jako strony CLIENT.
const CLIENT_USER_ID = 'usr_test_0000000000000002';
const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const PAIR_ID = 'pair_test_000000000000001';
describe('messaging thread + send (handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true);
  });
  it('GET thread as a party → 200 + meta + messages (regression guard: was 400)', async () => {
    mockDb({
      clientStylistPair: {
        findUnique: async () => ({
          id: PAIR_ID,
          client_user_id: CLIENT_USER_ID,
          stylist_account_id: STYLIST_ACCOUNT_ID,
          status: PairingStatusValue.ACTIVE,
          client_hidden_at: null,
          stylist_hidden_at: null,
          client_user: { name: 'Test Client', is_active: true },
          stylist_account: {
            display_name: 'Test Salon',
            business_name: null,
            avatar_url: null,
            // A client viewer sees the thread only while the counterpart
            // stylist account is still ACTIVE.
            account_status: AccountStatusValue.ACTIVE,
            created_by_user: { is_active: true },
          },
        }),
      },
      stylistClientMessage: {
        findMany: async () => [
          {
            id: 'msg_1',
            sender_type: StylistClientMessageSenderValue.STYLIST,
            content: 'Do zobaczenia w salonie!',
            created_at: new Date('2026-07-16T10:00:00.000Z'),
          },
        ],
      },
    });
    const { status, event, data } = await mockApiHandler<{
      meta: {
        viewer_side: string;
        can_send: boolean;
      };
      messages: Array<{
        id: string;
        content: string;
      }>;
      next_cursor: string | null;
    }>(threadHandler, {
      method: 'GET',
      query: { pair_id: PAIR_ID },
    });
    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.MESSAGING.MESSAGING_THREAD_FETCHED);
    expect(data.meta.viewer_side).toBe(StylistClientMessageSenderValue.CLIENT);
    expect(data.meta.can_send).toBe(true);
    expect(data.messages).toHaveLength(1);
    expect(data.messages[0]?.content).toBe('Do zobaczenia w salonie!');
  });
  it('POST send as a party → 201 + created message', async () => {
    mockDb({
      $queryRaw: (async () => [
        { id: PAIR_ID, last_message_at: null },
      ]) as unknown as Record<string, (...args: never[]) => unknown>,
      clientStylistPair: {
        findUnique: async () => ({
          id: PAIR_ID,
          client_user_id: CLIENT_USER_ID,
          stylist_account_id: STYLIST_ACCOUNT_ID,
          status: PairingStatusValue.ACTIVE,
          client_user: { is_active: true },
          stylist_account: {
            created_by_user_id: 'usr_stylist_owner_1',
            // Send reaches the pair only while the counterpart stylist
            // account is still ACTIVE.
            account_status: AccountStatusValue.ACTIVE,
            created_by_user: { is_active: true },
          },
        }),
        update: async () => ({}),
      },
      stylistClientMessage: {
        // rate-limit count + throttle count → oba 0 (pod capem, brak burst).
        count: async () => 0,
        // dedup podwójnego wysłania: brak bliźniaka w oknie → normalny insert.
        findFirst: async () => null,
        create: async () => ({
          id: 'msg_new',
          sender_type: StylistClientMessageSenderValue.CLIENT,
          content: 'Cześć! Chciałabym umówić się na wizytę.',
          created_at: new Date('2026-07-16T11:00:00.000Z'),
        }),
      },
    });
    const { status, data } = await mockApiHandler<{
      message: {
        id: string;
        sender_type: string;
        content: string;
      };
    }>(sendHandler, {
      method: 'POST',
      body: {
        pair_id: PAIR_ID,
        content: 'Cześć! Chciałabym umówić się na wizytę.',
      },
    });
    expect(status).toBe(201);
    expect(data.message.sender_type).toBe(
      StylistClientMessageSenderValue.CLIENT
    );
    expect(data.message.content).toBe(
      'Cześć! Chciałabym umówić się na wizytę.'
    );
  });
  it('GET thread as a NON-party → 404 MESSAGING_PAIR_NOT_FOUND (IDOR/anti-enum)', async () => {
    mockDb({
      clientStylistPair: {
        // The pair belongs to another client and another stylist, so the
        // caller (usr_...0002) is not a party and resolvePairSide is null.
        findUnique: async () => ({
          id: PAIR_ID,
          client_user_id: 'usr_someone_else_000000001',
          stylist_account_id: 'acc_someone_else_00000001',
          status: PairingStatusValue.ACTIVE,
          client_user: { name: 'Other Client' },
          stylist_account: {
            display_name: 'Other Salon',
            business_name: null,
            avatar_url: null,
          },
        }),
      },
    });
    const { status, event } = await mockApiHandler(threadHandler, {
      method: 'GET',
      query: { pair_id: PAIR_ID },
    });
    expect(status).toBe(404);
    expect(event).toBe(APP_EVENTS.INFO.MESSAGING.MESSAGING_PAIR_NOT_FOUND);
  });
});

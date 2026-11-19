/**
 * Integration-handler test — POST /messaging/hide + /messaging/unhide.
 *
 * Drives the real handlers through production middleware (auth / permission /
 * validation / error-mapper). Pins D2 hide=mute HTTP contract:
 *   party → 200 + HIDDEN/UNHIDDEN envelope
 *   non-party → 404 MESSAGING_PAIR_NOT_FOUND
 *   missing pair_id → 400 VALIDATION_FAILED
 */

import { describe, it, expect, beforeEach } from 'vitest';
import hideHandler from '../../pages/api/v1/messaging/hide/index';
import unhideHandler from '../../pages/api/v1/messaging/unhide/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const CLIENT_USER_ID = 'usr_test_0000000000000002';
const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const PAIR_ID = 'pair_test_000000000000001';

const partyPair = {
  id: PAIR_ID,
  client_user_id: CLIENT_USER_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  last_message_at: new Date('2026-07-16T10:00:00.000Z'),
  client_hidden_at: null as Date | null,
  stylist_hidden_at: null as Date | null,
};

describe('messaging hide + unhide (handler integration)', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true);
  });

  it('POST hide as a party → 200 + MESSAGING_CONVERSATION_HIDDEN + {pair_id, hidden_at}', async () => {
    mockDb({
      clientStylistPair: {
        findUnique: async () => partyPair,
        updateMany: async () => ({ count: 1 }),
      },
    });

    const { status, event, data } = await mockApiHandler<{
      pair_id: string;
      hidden_at: string;
    }>(hideHandler, {
      method: 'POST',
      body: { pair_id: PAIR_ID },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATION_HIDDEN);
    expect(data.pair_id).toBe(PAIR_ID);
    expect(data.hidden_at).toBeTruthy();
  });

  it('POST hide as a NON-party → 404 MESSAGING_PAIR_NOT_FOUND', async () => {
    mockDb({
      clientStylistPair: {
        findUnique: async () => ({
          ...partyPair,
          client_user_id: 'usr_someone_else_000000001',
          stylist_account_id: 'acc_someone_else_00000001',
        }),
      },
    });

    const { status, event } = await mockApiHandler(hideHandler, {
      method: 'POST',
      body: { pair_id: PAIR_ID },
    });

    expect(status).toBe(404);
    expect(event).toBe(APP_EVENTS.INFO.MESSAGING.MESSAGING_PAIR_NOT_FOUND);
  });

  it('POST unhide as a party → 200 + MESSAGING_CONVERSATION_UNHIDDEN', async () => {
    mockDb({
      clientStylistPair: {
        findUnique: async () => ({
          ...partyPair,
          client_hidden_at: new Date('2026-08-01T00:00:00.000Z'),
        }),
        updateMany: async () => ({ count: 1 }),
      },
    });

    const { status, event, data } = await mockApiHandler<{
      pair_id: string;
    }>(unhideHandler, {
      method: 'POST',
      body: { pair_id: PAIR_ID },
    });

    expect(status).toBe(200);
    expect(event).toBe(
      APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATION_UNHIDDEN
    );
    expect(data.pair_id).toBe(PAIR_ID);
  });

  it('POST hide without pair_id → 400 VALIDATION_FAILED', async () => {
    const { status, event } = await mockApiHandler(hideHandler, {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(400);
    expect(event).toBe(APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED);
  });
});

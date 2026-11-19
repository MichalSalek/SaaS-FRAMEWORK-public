/**
 * Unit test: messaging write gates (counterpart-visibility mask).
 *
 * Pins the same gate on sendMessage_IO and markRead_IO. A removed or
 * soft-deleted counterpart (the pair stays ACTIVE under Model A) must get the
 * same verdict as a non-party: MESSAGING_PAIR_NOT_FOUND, on both write paths.
 * markRead_IO used to skip the gate and write a watermark on a masked thread,
 * which also split the response (204 vs 404) and leaked existence.
 */
import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import {
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../../../test-utils/fixtures';
import {
  AccountStatusValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  MESSAGE_DEDUP_WINDOW_MS,
  sendMessage_IO,
  markRead_IO,
} from './messaging-write.operations';
const PAIR_ID = 'pair_test_000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
type PairRow = {
  id: string;
  client_user_id: string;
  stylist_account_id: string;
  status: string;
  last_message_at: Date;
  client_hidden_at: Date | null;
  stylist_hidden_at: Date | null;
  client_user: {
    is_active: boolean;
  };
  stylist_account: {
    created_by_user_id: string;
    account_status: string;
    created_by_user: {
      is_active: boolean;
    };
  };
};
const makePairRow = (over: {
  clientUserId: string;
  stylistOwnerUserId: string;
  clientIsActive?: boolean;
  stylistAccountStatus?: string;
  clientHiddenAt?: Date | null;
  stylistHiddenAt?: Date | null;
}): PairRow => ({
  id: PAIR_ID,
  client_user_id: over.clientUserId,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  status: PairingStatusValue.ACTIVE,
  last_message_at: new Date('2026-07-19T12:00:00.000Z'),
  client_hidden_at: over.clientHiddenAt ?? null,
  stylist_hidden_at: over.stylistHiddenAt ?? null,
  client_user: { is_active: over.clientIsActive ?? true },
  stylist_account: {
    created_by_user_id: over.stylistOwnerUserId,
    account_status: over.stylistAccountStatus ?? AccountStatusValue.ACTIVE,
    created_by_user: { is_active: true },
  },
});
/** A mock DB enough for both write paths (tx is the same proxy). */
const mockDbForPair = (
  pair: PairRow | null,
  duplicate: {
    id: string;
    sender_type: string;
    content: string;
    created_at: Date;
  } | null = null
) => {
  // The signature takes an explicit argument. The test asserts which watermark the update receives.
  const update = vi.fn(
    async (_args: { data: Record<string, unknown> }) => pair
  );
  const create = vi.fn(async () => ({
    id: 'msg_test_0000000000000001',
    sender_type: 'CLIENT',
    content: 'x',
    created_at: new Date('2026-07-19T12:00:00.000Z'),
  }));
  const count = vi.fn(async () => 0);
  const findUnique = vi.fn(async () => pair);
  const findFirst = vi.fn(
    async (_args: { where: Record<string, unknown> }) => duplicate
  );
  __setDb({
    clientStylistPair: { findUnique, update, updateMany: update },
    stylistClientMessage: { create, count, findFirst },
    $queryRaw: vi.fn(async () =>
      pair ? [{ id: pair.id, last_message_at: null }] : []
    ),
  });
  return { findUnique, update, create, count, findFirst };
};
describe('counterpart-visibility mask — parytet sendMessage_IO ↔ markRead_IO', () => {
  it('markRead_IO: soft-deleted klientka maskuje parę dla stylistki (PAIR_NOT_FOUND, zero zapisu)', async () => {
    const currentUser = makeStylistCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: 'usr_test_0000000000000002',
        stylistOwnerUserId: currentUser.id,
        clientIsActive: false,
      })
    );
    const result = await markRead_IO({ currentUser, pairId: PAIR_ID });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_PAIR_NOT_FOUND');
    expect(db.update).not.toHaveBeenCalled();
  });
  it('markRead_IO: zdjęte konto stylistki (account_status !== ACTIVE) maskuje parę dla klientki', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: 'usr_test_0000000000000001',
        stylistAccountStatus: AccountStatusValue.NOT_ACTIVE,
      })
    );
    const result = await markRead_IO({ currentUser, pairId: PAIR_ID });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_PAIR_NOT_FOUND');
    expect(db.update).not.toHaveBeenCalled();
  });
  it('sendMessage_IO daje TEN SAM werdykt dla zdjętego counterparta (baseline parytetu)', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: 'usr_test_0000000000000001',
        stylistAccountStatus: AccountStatusValue.NOT_ACTIVE,
      })
    );
    const result = await sendMessage_IO({
      currentUser,
      pairId: PAIR_ID,
      content: 'Cześć',
    });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_PAIR_NOT_FOUND');
    expect(db.create).not.toHaveBeenCalled();
  });
  it('markRead_IO z żywym counterpartem nadal zapisuje watermark własnej strony', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: 'usr_test_0000000000000001',
      })
    );
    const result = await markRead_IO({ currentUser, pairId: PAIR_ID });
    expect(result.success).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0]?.[0]?.data).toHaveProperty(
      'client_last_read_at'
    );
  });
  it('markRead_IO: nie-strona dostaje ten sam werdykt co zamaskowana para', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: 'usr_test_0000000000000009',
        stylistOwnerUserId: 'usr_test_0000000000000001',
      })
    );
    const result = await markRead_IO({ currentUser, pairId: PAIR_ID });
    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_PAIR_NOT_FOUND');
    expect(db.update).not.toHaveBeenCalled();
  });
});
const SUCCESS_KEYS = [
  'message',
  'notifyRecipientUserId',
  'senderSide',
  'pairStatus',
] as const;
describe('sendMessage_IO — hide = mute (notify suppression)', () => {
  it('recipient hidden (client sends, stylist_hidden_at set) → success + create + last_message_at bump + notify null', async () => {
    const currentUser = makeClientCurrentUser();
    const ownerId = 'usr_stylist_owner_1';
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: ownerId,
        stylistHiddenAt: new Date('2026-08-01T00:00:00.000Z'),
      })
    );
    const result = await sendMessage_IO({
      currentUser,
      pairId: PAIR_ID,
      content: 'Cześć',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(Object.keys(result.data).sort()).toEqual([...SUCCESS_KEYS].sort());
    expect(result.data.notifyRecipientUserId).toBeNull();
    expect(result.data.senderSide).toBe('CLIENT');
    expect(db.create).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ last_message_at: expect.any(Date) })
    );
  });
  it('recipient NOT hidden → notify = recipient id; same success keys (anti-oracle)', async () => {
    const currentUser = makeClientCurrentUser();
    const ownerId = 'usr_stylist_owner_1';
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: ownerId,
      })
    );
    const result = await sendMessage_IO({
      currentUser,
      pairId: PAIR_ID,
      content: 'Cześć',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(Object.keys(result.data).sort()).toEqual([...SUCCESS_KEYS].sort());
    expect(result.data.notifyRecipientUserId).toBe(ownerId);
    expect(result.data.senderSide).toBe('CLIENT');
    expect(db.create).toHaveBeenCalledTimes(1);
    expect(db.update.mock.calls[0]?.[0]?.data).toEqual(
      expect.objectContaining({ last_message_at: expect.any(Date) })
    );
  });
  it("sender's OWN hidden flag does not suppress (sender hidden, recipient not → notify set)", async () => {
    const currentUser = makeClientCurrentUser();
    const ownerId = 'usr_stylist_owner_1';
    mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: ownerId,
        clientHiddenAt: new Date('2026-08-01T00:00:00.000Z'),
      })
    );
    const result = await sendMessage_IO({
      currentUser,
      pairId: PAIR_ID,
      content: 'Cześć',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.notifyRecipientUserId).toBe(ownerId);
  });
});
describe('sendMessage_IO — dedup podwójnego wysłania', () => {
  const existing = {
    id: 'msg_existing_00000000001',
    sender_type: 'CLIENT',
    content: 'Cześć',
    created_at: new Date(),
  };
  it('ta sama treść od tej samej strony w oknie → istniejąca wiadomość, bez insertu i bez powiadomienia', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: 'usr_stylist_owner_1',
      }),
      existing
    );
    const result = await sendMessage_IO({
      currentUser,
      pairId: PAIR_ID,
      content: 'Cześć',
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(Object.keys(result.data).sort()).toEqual([...SUCCESS_KEYS].sort());
    expect(result.data.message.id).toBe(existing.id);
    expect(result.data.notifyRecipientUserId).toBeNull();
    expect(db.create).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    const where = db.findFirst.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({
      pair_id: PAIR_ID,
      sender_type: 'CLIENT',
      content: 'Cześć',
    });
    const since = (
      where?.created_at as {
        gte: Date;
      }
    ).gte.getTime();
    expect(Date.now() - since).toBeGreaterThanOrEqual(
      MESSAGE_DEDUP_WINDOW_MS - 50
    );
    expect(Date.now() - since).toBeLessThanOrEqual(
      MESSAGE_DEDUP_WINDOW_MS + 1000
    );
  });
  it('poza oknem (brak bliźniaka) → nowa wiadomość i powiadomienie', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForPair(
      makePairRow({
        clientUserId: currentUser.id,
        stylistOwnerUserId: 'usr_stylist_owner_1',
      })
    );
    const result = await sendMessage_IO({
      currentUser,
      pairId: PAIR_ID,
      content: 'Cześć',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifyRecipientUserId).toBe('usr_stylist_owner_1');
    }
    expect(db.create).toHaveBeenCalledTimes(1);
  });
});

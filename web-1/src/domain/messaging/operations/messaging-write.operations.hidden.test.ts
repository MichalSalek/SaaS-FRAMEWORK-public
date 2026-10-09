/**
 * Unit test — messaging write-gates (counterpart-visibility mask).
 *
 * Pinuje PARYTET bramek między sendMessage_IO a markRead_IO: zdjęty/soft-deleted
 * counterpart (para zostaje ACTIVE per Model A) musi dawać ten sam werdykt co
 * nie-strona — MESSAGING_PAIR_NOT_FOUND — na OBU ścieżkach zapisu. markRead_IO
 * miał tę bramkę pominiętą (guard-parity oversight): zapisywał watermark do
 * zamaskowanego wątku, co dodatkowo różnicowało odpowiedź (204 vs 404) i dawało
 * existence-oracle. Test trzyma obie ścieżki na jednym predykacie.
 */

import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import {
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../../../test-utils/fixtures';
import { setConversationHidden_IO } from './messaging-write.operations';

const PAIR_ID = 'pair_test_000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';

type HidePairRow = {
  id: string;
  client_user_id: string;
  stylist_account_id: string;
  last_message_at: Date | null;
  client_hidden_at: Date | null;
  stylist_hidden_at: Date | null;
};

const mockDbForHide = (pair: HidePairRow | null) => {
  const findUnique = vi.fn(async () => pair);
  const updateMany = vi.fn(
    async (_args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => ({ count: 1 })
  );
  __setDb({
    clientStylistPair: { findUnique, updateMany },
  });
  return { findUnique, updateMany };
};

describe('setConversationHidden_IO', () => {
  it('non-party → MESSAGING_PAIR_NOT_FOUND', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: 'usr_someone_else_000000001',
      stylist_account_id: 'acc_someone_else_00000001',
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_PAIR_NOT_FOUND');
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('missing pair → MESSAGING_PAIR_NOT_FOUND', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide(null);

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_PAIR_NOT_FOUND');
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('hide on a pair with last_message_at:null → MESSAGING_NOT_ALLOWED', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: null,
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('MESSAGING_NOT_ALLOWED');
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('hide as client → updateMany WHERE {id, client_user_id} and client_hidden_at = Date', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.pair_id).toBe(PAIR_ID);
    expect(result.data.hidden_at).toBeInstanceOf(Date);
    expect(db.updateMany).toHaveBeenCalledTimes(1);
    expect(db.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: PAIR_ID, client_user_id: currentUser.id },
      data: { client_hidden_at: expect.any(Date) },
    });
  });

  it('hide as stylist → updateMany WHERE {id, stylist_account_id} and stylist_hidden_at = Date', async () => {
    const currentUser = makeStylistCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: 'usr_test_0000000000000002',
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.hidden_at).toBeInstanceOf(Date);
    expect(db.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { id: PAIR_ID, stylist_account_id: STYLIST_ACCOUNT_ID },
      data: { stylist_hidden_at: expect.any(Date) },
    });
  });

  it('hide again → original timestamp, updateMany NOT called', async () => {
    const currentUser = makeClientCurrentUser();
    const original = new Date('2026-06-01T00:00:00.000Z');
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: original,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.hidden_at).toBe(original);
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('unhide → hidden_at null and updateMany writes null', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: new Date('2026-06-01T00:00:00.000Z'),
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.hidden_at).toBeNull();
    expect(db.updateMany).toHaveBeenCalledTimes(1);
    expect(db.updateMany.mock.calls[0]?.[0]?.data).toEqual({
      client_hidden_at: null,
    });
  });

  it('unhide when already null → no updateMany', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.hidden_at).toBeNull();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('hide works for status REVOKED (no status gate)', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(true);
    expect(db.updateMany).toHaveBeenCalledTimes(1);
  });

  it('hide works with an inactive counterpart (no liveness gate)', async () => {
    const currentUser = makeClientCurrentUser();
    const db = mockDbForHide({
      id: PAIR_ID,
      client_user_id: currentUser.id,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      last_message_at: new Date('2026-07-16T10:00:00.000Z'),
      client_hidden_at: null,
      stylist_hidden_at: null,
    });

    const result = await setConversationHidden_IO({
      currentUser,
      pairId: PAIR_ID,
      hidden: true,
    });

    expect(result.success).toBe(true);
    expect(db.updateMany).toHaveBeenCalledTimes(1);
  });
});

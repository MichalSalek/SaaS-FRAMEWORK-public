/**
 * Durability of a stylist removing a client (`revoked_by`).
 *
 * A separate suite because pair-request.operations.test.ts reached the max-lines
 * limit. The cases are one topic: who cut the relation decides whether the client
 * can raise it again with another request.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPairRequest_IO } from './pair-request.operations';
import {
  mockCreateScenario,
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

describe('createPairRequest_IO — kto zerwał relację, ten decyduje o powrocie', () => {
  it('zerwanie PRZEZ STYLISTKĘ jest nieodwracalne — ponowna prośba nie podnosi pary, tylko maskowany NOT_FOUND', async () => {
    // The regression this pins: every REVOKED row returned to PENDING, and PENDING
    // opens the messenger, so a removed client regained the right to write to the
    // stylist's inbox with one POST. The way back is only scanning the stylist's
    // code (her consent), never a one-sided request.
    const { create, updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED', revoked_by: 'STYLIST' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // The same error as a missing or inactive stylist. The client cannot tell
      // whether she was removed or the account vanished (anti-oracle).
      expect(result.error.type).toBe('PAIR_REQUEST_STYLIST_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('zerwanie PRZEZ KLIENTKĘ zostaje odwracalne — własna rezygnacja nie zamyka drogi powrotu', async () => {
    const { updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED', revoked_by: 'CLIENT' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('wiersz sprzed kolumny revoked_by (NULL) zachowuje się jak zerwanie po stronie klientki', async () => {
    // Relations whose cutter is unknown are not blocked after the fact.
    const { updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED', revoked_by: null },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});

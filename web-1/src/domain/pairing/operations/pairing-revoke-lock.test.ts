// Revoke takes the same StylistAccount lock as favorite add before it deletes likes,
// then locks the ACTIVE pair (lockActivePair, the re-check) before closing sessions.
// Live interleaving: tests/concurrency/favorite-revoke-race.concurrency.ts.
import { describe, it, expect, vi } from 'vitest';
import { __setDb as mockDb } from '../../../test-utils/setup';
import { revokePairingAccessCore_IO } from './pairing-revoke-core.operations';

vi.mock('@domain/visit/operations/visit-session-archive.operations', () => ({
  scheduleSessionVisitArchiveBestEffort: vi.fn(),
}));

const CLIENT = 'usr_client_00000000000001';
const DIRECT = 'acc_direct_00000000000001';
const PAIR = 'pair_000000000000000000001';

describe('revokePairingAccessCore_IO: same lock, pair locked under it', () => {
  it('takes the stylist lock before deleting likes', async () => {
    const order: string[] = [];
    mockDb({
      clientStylistPair: {
        findFirst: vi.fn(async () => {
          order.push('pair');
          return {
            id: PAIR,
            client_user_id: CLIENT,
            salon_origin_account_id: null,
            stylist_account_id: DIRECT,
          };
        }),
        update: vi.fn(async () => ({ id: PAIR })),
      },
      favoriteGalleryRecord: {
        deleteMany: vi.fn(async () => {
          order.push('deleteLikes');
          return { count: 0 };
        }),
      },
      clientAccount: { findUnique: vi.fn(async () => null) },
      $queryRaw: vi
        .fn()
        .mockImplementationOnce(async () => {
          order.push('lockAccount');
          return [{ account_id: DIRECT }];
        })
        .mockImplementationOnce(async () => {
          order.push('lockPair');
          return [{ id: PAIR }];
        }),
    });

    const result = await revokePairingAccessCore_IO({
      current_user_id: CLIENT,
      target_account_id: DIRECT,
    });

    expect(result.success).toBe(true);
    expect(order.slice(0, 4)).toEqual([
      'pair',
      'lockAccount',
      'lockPair',
      'deleteLikes',
    ]);
  });

  it('a parallel revoke already won the lock: idempotent success, no second cascade', async () => {
    const deleteMany = vi.fn();
    const update = vi.fn();
    const findFirst = vi.fn().mockResolvedValueOnce({
      id: PAIR,
      client_user_id: CLIENT,
      salon_origin_account_id: null,
      stylist_account_id: DIRECT,
    });
    mockDb({
      clientStylistPair: { findFirst, update },
      favoriteGalleryRecord: { deleteMany },
      // StylistAccount lock returns the row; the pair lock returns none (no longer ACTIVE).
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ account_id: DIRECT }])
        .mockResolvedValueOnce([]),
    });

    const result = await revokePairingAccessCore_IO({
      current_user_id: CLIENT,
      target_account_id: DIRECT,
    });

    expect(result).toEqual({ success: true, data: { success: true } });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

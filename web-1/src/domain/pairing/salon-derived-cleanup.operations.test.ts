import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
const access = vi.fn();
const revoke = vi.fn();
vi.mock('./salon-access.resolver', () => ({
  resolveSalonAccess_IO: (...args: unknown[]) => access(...args),
}));
vi.mock('./operations/pairing-revoke-core.operations', () => ({
  revokePairingAccessCore_IO: (...args: unknown[]) => revoke(...args),
}));
const report = vi.fn();
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: (...args: unknown[]) => report(...args),
}));
import {
  reconcileSalonDerivedPairings_IO,
  reconcileSalonDerivedPairingsAfterCommit_IO,
} from './salon-derived-cleanup.operations';

describe('salon derived disconnect reconciliation', () => {
  it('walks every bounded page and never selects direct rows', async () => {
    access.mockResolvedValue(null);
    revoke.mockResolvedValue({ success: true, data: { success: true } });
    const rows = Array.from({ length: 101 }, (_, i) => ({
      id: `pair-${i}`,
      client_user_id: `client-${i}`,
      stylist_account_id: 'member',
    }));
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(rows.slice(0, 100))
      .mockResolvedValueOnce(rows.slice(100));
    mockDb({ clientStylistPair: { findMany } });
    await reconcileSalonDerivedPairings_IO({ salonAccountId: 'salon' });
    expect(revoke).toHaveBeenCalledTimes(101);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: { id: 'pair-99' },
        skip: 1,
        take: 100,
        where: expect.objectContaining({ salon_origin_account_id: 'salon' }),
      })
    );
  });
  it('keeps derived contact if another current direct salon connection survives', async () => {
    access.mockResolvedValue({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: 'pair',
    });
    revoke.mockClear();
    mockDb({
      clientStylistPair: {
        findMany: async () => [
          {
            id: 'pair',
            client_user_id: 'client',
            stylist_account_id: 'member',
          },
        ],
      },
    });
    await reconcileSalonDerivedPairings_IO({ clientUserId: 'client' });
    expect(revoke).not.toHaveBeenCalled();
  });
  it('after a committed change, a failed cleanup is reported, not thrown into the action', async () => {
    access.mockResolvedValue(null);
    revoke.mockResolvedValue({
      success: false,
      error: { type: 'DATABASE_ERROR' },
    });
    mockDb({
      clientStylistPair: {
        findMany: async () => [
          { id: 'p1', client_user_id: 'c1', stylist_account_id: 'm1' },
        ],
      },
    });
    await expect(
      reconcileSalonDerivedPairingsAfterCommit_IO(
        { salonAccountId: 'salon' },
        'leaveSalonTeam'
      )
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'salon-derived-reconcile',
        mode: 'error',
        payload: expect.objectContaining({ salonAccountId: 'salon' }),
      })
    );
  });
});

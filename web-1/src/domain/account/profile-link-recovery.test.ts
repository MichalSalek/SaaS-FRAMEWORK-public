import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../prisma/js-client';

const locks = vi.hoisted(() => ({
  owner: vi.fn(),
  advisory: vi.fn(async () => undefined),
}));
vi.mock('@app/db/lock-rows', () => ({
  lockStylistAccountByOwnerUser: locks.owner,
  acquireAdvisoryXactLock: locks.advisory,
}));
import { prepareRecoveredVanity } from './profile-link-recovery';

describe('recovery vanity namespace', () => {
  it('does not shadow another owner’s retired link and preserves the existing live one', async () => {
    locks.owner.mockResolvedValue({ account_id: 'current-account' });
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      stylistAccount: {
        findUnique: vi.fn(async () => ({ vanity_url: 'current-link' })),
        findFirst: vi.fn(async () => null),
      },
      profileLinkAlias: {
        findUnique: vi.fn(async () => ({ account_id: 'other-account' })),
        createMany,
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as Prisma.TransactionClient;
    expect(await prepareRecoveredVanity(tx, 'user', 'retired-link')).toBeNull();
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            kind: 'STYLIST',
            slug: 'current-link',
            account_id: 'current-account',
          },
        ],
      })
    );
    expect(locks.advisory).toHaveBeenCalledWith(
      tx,
      'profile-link:STYLIST:retired-link'
    );
  });
});

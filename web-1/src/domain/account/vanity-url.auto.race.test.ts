import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../test-utils/setup';
import { assignAutoVanityUrl_IO } from './vanity-url.auto';

describe('automatic vanity assignment', () => {
  it('does not claim a link retired after the initial availability reads', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    __setDb({
      $queryRaw: vi.fn(async () => [{ account_id: 'account' }]),
      stylistAccount: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
        updateMany,
      },
      profileLinkAlias: {
        findMany: vi.fn(async () => []),
        findUnique: vi.fn(async () => ({ account_id: 'another-owner' })),
      },
    });
    await assignAutoVanityUrl_IO('account', ['Anna']);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';

vi.mock('../salon-access.resolver', () => ({
  resolveSalonAccess_IO: vi.fn(async () => {
    throw new Error('database unavailable');
  }),
}));
import { getAccessStatus_IO } from './pairing-access.operations';

describe('getAccessStatus_IO', () => {
  it('returns a database failure when checking derived salon access fails', async () => {
    __setDb({
      clientStylistPair: {
        findFirst: vi.fn(async () => ({
          id: 'pair',
          status: 'ACTIVE',
          paired_at: new Date(),
          salon_origin_account_id: 'salon',
        })),
      },
    });
    const result = await getAccessStatus_IO({
      client_user_id: 'client',
      stylist_account_id: 'stylist',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'DATABASE_ERROR' },
    });
  });
});

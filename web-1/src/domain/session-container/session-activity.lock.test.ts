import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../prisma/js-client';

const resolveSalonAccess = vi.hoisted(() => vi.fn());
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: resolveSalonAccess,
  ensureSalonPairing_IO: vi.fn(),
}));
vi.mock('@app/db/lock-rows', () => ({
  lockUserRow: vi.fn(async () => ({ id: 'user' })),
  lockStylistAccount: vi.fn(async () => ({ account_id: 'stylist' })),
  lockSessionContainer: vi.fn(async () => ({ id: 'session' })),
  lockConversation: vi.fn(async () => ({ id: 'pair', last_message_at: null })),
}));
import { lockSessionActivityContext } from './session-activity.lock';

describe('session activity access', () => {
  it('does not treat a stale derived salon pair as active', async () => {
    resolveSalonAccess.mockResolvedValue(null);
    const session = { id: 'session', stylist_account_id: 'stylist' };
    const tx = {
      sessionContainer: {
        findUnique: vi.fn().mockResolvedValueOnce({
          ...session,
          client_account: { created_by_user_id: 'client' },
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(session),
      },
      stylistAccount: {
        findUnique: vi.fn().mockResolvedValue({ created_by_user_id: 'owner' }),
      },
      clientStylistPair: {
        findUnique: vi.fn().mockResolvedValue({ id: 'pair' }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'pair',
          salon_origin_account_id: 'salon',
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const context = await lockSessionActivityContext(tx, 'session');
    expect(context?.activePairId).toBeNull();
    expect(resolveSalonAccess).toHaveBeenCalledWith('client', 'stylist', tx);
  });

  it.each([
    { origin: null, access: null, calls: 0 },
    { origin: 'salon', access: { kind: 'SALON' }, calls: 1 },
  ])(
    'retains current direct and valid salon access: $origin',
    async ({ origin, access, calls }) => {
      resolveSalonAccess.mockReset().mockResolvedValue(access);
      const session = { id: 'session', stylist_account_id: 'stylist' };
      const tx = {
        sessionContainer: {
          findUnique: vi.fn().mockResolvedValue({
            ...session,
            client_account: { created_by_user_id: 'client' },
          }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(session),
        },
        stylistAccount: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ created_by_user_id: 'owner' }),
        },
        clientStylistPair: {
          findUnique: vi.fn().mockResolvedValue({ id: 'pair' }),
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: 'pair', salon_origin_account_id: origin }),
        },
      } as unknown as Prisma.TransactionClient;

      const context = await lockSessionActivityContext(tx, 'session');
      expect(context?.activePairId).toBe('pair');
      expect(resolveSalonAccess).toHaveBeenCalledTimes(calls);
    }
  );
});

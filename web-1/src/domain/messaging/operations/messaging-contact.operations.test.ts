import { describe, expect, it, vi } from 'vitest';
import { __setDb } from '../../../test-utils/setup';
import {
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../../../test-utils/fixtures';
import { openContact_IO, endContact_IO } from './messaging-contact.operations';

const stylistId = 'stylist-1';
const stylist = {
  account_status: 'ACTIVE',
  created_by_user_id: 'stylist-user',
  created_by_user: { is_active: true },
};

describe('contact conversations', () => {
  it('preserves the established client-ended interpretation of a legacy null revoker', async () => {
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    __setDb({
      stylistAccount: { findUnique: vi.fn(async () => stylist) },
      clientStylistPair: {
        findUnique: vi.fn(async () => ({
          id: 'legacy-pair',
          status: 'REVOKED',
          revoked_by: null,
        })),
        updateMany,
      },
    });
    expect(
      (
        await openContact_IO({
          currentUser: makeClientCurrentUser(),
          stylistAccountId: stylistId,
        })
      ).success
    ).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'legacy-pair', status: 'REVOKED', revoked_by: null },
        data: { status: 'CONTACT' },
      })
    );
  });
  it('creates CONTACT without sending or creating a pairing request', async () => {
    const create = vi.fn(async (_args: unknown) => ({ id: 'pair-1' }));
    __setDb({
      stylistAccount: { findUnique: vi.fn(async () => stylist) },
      clientStylistPair: { findUnique: vi.fn(async () => null), create },
    });
    const result = await openContact_IO({
      currentUser: makeClientCurrentUser(),
      stylistAccountId: stylistId,
    });
    expect(result).toMatchObject({
      success: true,
      data: { pair_id: 'pair-1' },
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { status: 'CONTACT' },
    });
  });
  it('masks a stylist-side revocation, while a client-side end may reopen without unmuting', async () => {
    const updateMany = vi.fn(
      async (_args: { data: Record<string, unknown> }) => ({ count: 1 })
    );
    const findUnique = vi.fn(async () => ({
      id: 'pair-1',
      status: 'REVOKED',
      revoked_by: 'STYLIST',
    }));
    __setDb({
      stylistAccount: { findUnique: vi.fn(async () => stylist) },
      clientStylistPair: { findUnique, updateMany },
    });
    const params = {
      currentUser: makeClientCurrentUser(),
      stylistAccountId: stylistId,
    };
    expect(await openContact_IO(params)).toMatchObject({
      success: false,
      error: { type: 'MESSAGING_PAIR_NOT_FOUND' },
    });
    expect(updateMany).not.toHaveBeenCalled();
    findUnique.mockResolvedValueOnce({
      id: 'pair-1',
      status: 'REVOKED',
      revoked_by: 'CLIENT',
    });
    expect(await openContact_IO(params)).toMatchObject({ success: true });
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { status: 'CONTACT' },
    });
    expect(updateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty(
      'stylist_hidden_at'
    );
  });
  it('ends only the caller’s CONTACT with the caller recorded', async () => {
    const user = makeStylistCurrentUser();
    const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
    __setDb({
      clientStylistPair: {
        findUnique: vi.fn(async () => ({
          id: 'pair-1',
          client_user_id: 'other',
          stylist_account_id: user.stylist_account?.account_id,
        })),
        updateMany,
      },
    });
    expect(
      await endContact_IO({ currentUser: user, pairId: 'pair-1' })
    ).toMatchObject({ success: true });
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { status: 'CONTACT' },
      data: { status: 'REVOKED', revoked_by: 'STYLIST' },
    });
  });
});

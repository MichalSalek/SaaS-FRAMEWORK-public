import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
const { setAvatar } = vi.hoisted(() => ({ setAvatar: vi.fn() }));
vi.mock('@domain/user/operations/user-avatar.operations', () => ({
  userSetAvatar_IO: setAvatar,
}));
import {
  accountSetAvatar_IO,
  collectStylistAvatarUrlsForUser_IO,
} from './account-avatar.operations';

beforeEach(() => vi.clearAllMocks());
describe('legacy avatar adapter', () => {
  it('derives the user from the account and delegates', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ created_by_user_id: 'owner' }),
      },
    });
    setAvatar.mockResolvedValue({
      success: true,
      data: { user_id: 'owner', avatar_url: 'photo' },
    });
    const result = await accountSetAvatar_IO({
      account_id: 'account',
      avatar_url: 'photo',
    });
    expect(setAvatar).toHaveBeenCalledWith({
      userId: 'owner',
      avatar_url: 'photo',
    });
    expect(result).toEqual({
      success: true,
      data: { account_id: 'account', avatar_url: 'photo' },
    });
  });
  it('does not write for a missing account', async () => {
    mockDb({ stylistAccount: { findUnique: async () => null } });
    expect(
      (await accountSetAvatar_IO({ account_id: 'missing', avatar_url: null }))
        .success
    ).toBe(false);
    expect(setAvatar).not.toHaveBeenCalled();
  });
  it('propagates validation and database errors', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ created_by_user_id: 'owner' }),
      },
    });
    setAvatar.mockResolvedValue({
      success: false,
      error: {
        type: 'VALIDATION_ERROR',
        field: 'avatar_url',
        message: 'foreign',
      },
    });
    expect(
      (
        await accountSetAvatar_IO({
          account_id: 'account',
          avatar_url: 'foreign',
        })
      ).success
    ).toBe(false);
  });
  it('collects custom photos and logos, deduplicated, before terminal deletion', async () => {
    mockDb({
      stylistAccount: {
        findMany: async () => [{ avatar_url: 'photo', salon_logo_url: 'logo' }],
      },
      user: { findUnique: async () => ({ avatar_url: 'photo' }) },
    });
    expect(await collectStylistAvatarUrlsForUser_IO('owner')).toEqual([
      'photo',
      'logo',
    ]);
  });
});

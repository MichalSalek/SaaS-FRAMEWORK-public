import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const order: string[] = [];
  const user = { findUnique: vi.fn(), update: vi.fn() };
  const stylistAccount = { update: vi.fn(), findUnique: vi.fn() };
  const tx = { user, stylistAccount };
  return {
    order,
    user,
    stylistAccount,
    tx,
    stylist: { value: true },
    ownership: vi.fn(),
    cleanup: vi.fn(),
  };
});
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: { $transaction: async (fn: (tx: typeof h.tx) => unknown) => fn(h.tx) },
  },
}));
vi.mock('@app/db/lock-rows', () => ({
  lockUserRow: vi.fn(async () => {
    h.order.push('user');
    return { id: 'user' };
  }),
  lockStylistAccountByOwnerUser: vi.fn(async () => {
    h.order.push('stylist');
    return h.stylist.value ? { account_id: 'stylist' } : null;
  }),
}));
vi.mock('@domain/_shared/guards/cloudinary-asset.guard', () => ({
  findForeignAssetOwner: h.ownership,
}));
vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAssets: h.cleanup,
}));
import { userSetAvatar_IO } from './user-avatar.operations';
const OLD = 'https://res.cloudinary.com/test/image/upload/v1/nailfolio/old.jpg';
const NEW = 'https://res.cloudinary.com/test/image/upload/v1/nailfolio/new.jpg';
beforeEach(() => {
  vi.resetAllMocks();
  h.order.length = 0;
  h.stylist.value = true;
  h.user.findUnique.mockResolvedValue({
    avatar_url: OLD,
    is_active: true,
    disabled_at: null,
    deleted_at: null,
  });
  h.ownership.mockResolvedValue('OWN');
  h.stylistAccount.findUnique.mockResolvedValue({ avatar_url: OLD });
});
describe('personal avatar', () => {
  it('locks user before stylist and updates both URLs and ids atomically', async () => {
    expect(
      (await userSetAvatar_IO({ userId: 'user', avatar_url: NEW })).success
    ).toBe(true);
    expect(h.order).toEqual(['user', 'stylist']);
    expect(h.ownership).toHaveBeenCalledWith(NEW, { userId: 'user' });
    expect(h.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatar_url: NEW, avatar_public_id: 'nailfolio/new' },
      })
    );
    expect(h.stylistAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatar_url: NEW, avatar_public_id: 'nailfolio/new' },
      })
    );
    expect(h.cleanup).toHaveBeenCalledWith([OLD]);
  });
  it('supports client-only users and clearing without touching OAuth', async () => {
    h.stylist.value = false;
    expect(
      (await userSetAvatar_IO({ userId: 'user', avatar_url: null })).success
    ).toBe(true);
    expect(h.stylistAccount.update).not.toHaveBeenCalled();
    expect(h.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { avatar_url: null, avatar_public_id: null },
      })
    );
    expect(h.cleanup).toHaveBeenCalledWith([OLD]);
  });
  it('never deletes the current file on a same URL write', async () => {
    await userSetAvatar_IO({ userId: 'user', avatar_url: OLD });
    expect(h.cleanup).not.toHaveBeenCalled();
  });
  it.each(['FOREIGN', 'UNRECOGNIZED_URL'])(
    'rejects %s without writing',
    async verdict => {
      h.ownership.mockResolvedValue(verdict);
      expect(
        (await userSetAvatar_IO({ userId: 'user', avatar_url: NEW })).success
      ).toBe(false);
      expect(h.user.update).not.toHaveBeenCalled();
    }
  );
  it('does not clean a file when the transaction write fails', async () => {
    h.user.update.mockRejectedValueOnce(new Error('database unavailable'));
    expect(
      (await userSetAvatar_IO({ userId: 'user', avatar_url: NEW })).success
    ).toBe(false);
    expect(h.cleanup).not.toHaveBeenCalled();
  });
  it('cleans both displaced custom and legacy mirror assets', async () => {
    const legacy =
      'https://res.cloudinary.com/test/image/upload/v1/nailfolio/legacy.jpg';
    h.stylistAccount.findUnique.mockResolvedValue({ avatar_url: legacy });
    await userSetAvatar_IO({ userId: 'user', avatar_url: NEW });
    expect(h.cleanup).toHaveBeenCalledWith([OLD, legacy]);
  });
  it('rejects an inactive user before writing', async () => {
    h.user.findUnique.mockResolvedValue({
      avatar_url: OLD,
      is_active: false,
      disabled_at: null,
      deleted_at: null,
    });
    expect(
      (await userSetAvatar_IO({ userId: 'user', avatar_url: null })).success
    ).toBe(false);
    expect(h.user.update).not.toHaveBeenCalled();
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  order: [] as string[],
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  stylistAccount: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  cleanup: vi.fn(),
  ownership: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ user: h.user, stylistAccount: h.stylistAccount }),
    },
  },
}));
vi.mock('@app/db/lock-rows', () => ({
  lockUserRow: vi.fn(async () => {
    h.order.push('user');
    return { id: 'user' };
  }),
  lockStylistAccountByOwnerUser: vi.fn(async () => {
    h.order.push('stylist');
    return { account_id: 'stylist' };
  }),
}));
vi.mock('@domain/_shared/guards/cloudinary-asset.guard', () => ({
  findForeignAssetOwner: h.ownership,
}));
vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAsset: h.cleanup,
}));
import { reconcileLegacyAvatarForUser_IO } from './user-avatar-reconcile.operations';
beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  h.ownership.mockResolvedValue('OWN');
});
it('copies a legacy clear after locking User then StylistAccount', async () => {
  h.user.findUniqueOrThrow.mockResolvedValue({ avatar_url: 'old' });
  h.stylistAccount.findUniqueOrThrow.mockResolvedValue({
    avatar_url: null,
    avatar_public_id: null,
  });
  await reconcileLegacyAvatarForUser_IO('user');
  expect(h.order).toEqual(['user', 'stylist']);
  expect(h.user.update).toHaveBeenCalledWith({
    where: { id: 'user' },
    data: { avatar_url: null, avatar_public_id: null },
  });
  expect(h.cleanup).toHaveBeenCalledWith('old');
});

it('rejects a foreign legacy reference before writing or cleaning', async () => {
  h.user.findUniqueOrThrow.mockResolvedValue({
    avatar_url: 'old',
    avatar_public_id: null,
  });
  h.stylistAccount.findUniqueOrThrow.mockResolvedValue({
    avatar_url:
      'https://res.cloudinary.com/test/image/upload/v1/nailfolio/foreign.jpg',
    avatar_public_id: 'nailfolio/foreign',
  });
  h.ownership.mockResolvedValue('FOREIGN');
  await expect(reconcileLegacyAvatarForUser_IO('user')).rejects.toThrow(
    'FOREIGN'
  );
  expect(h.ownership).toHaveBeenCalledWith(
    expect.any(String),
    { userId: 'user' },
    expect.objectContaining({ user: h.user, stylistAccount: h.stylistAccount })
  );
  expect(h.user.update).not.toHaveBeenCalled();
  expect(h.cleanup).not.toHaveBeenCalled();
});

it('rejects unrecognized legacy URLs and retains the canonical photo', async () => {
  h.user.findUniqueOrThrow.mockResolvedValue({
    avatar_url: 'old',
    avatar_public_id: null,
  });
  h.stylistAccount.findUniqueOrThrow.mockResolvedValue({
    avatar_url: 'opaque',
    avatar_public_id: null,
  });
  h.ownership.mockResolvedValue('UNRECOGNIZED_URL');
  await expect(reconcileLegacyAvatarForUser_IO('user')).rejects.toThrow(
    'UNRECOGNIZED_URL'
  );
  expect(h.user.update).not.toHaveBeenCalled();
});

it('derives the public id from the checked URL instead of trusting the legacy id', async () => {
  const url =
    'https://res.cloudinary.com/test/image/upload/v1/nailfolio/actual.jpg';
  h.user.findUniqueOrThrow.mockResolvedValue({
    avatar_url: null,
    avatar_public_id: null,
  });
  h.stylistAccount.findUniqueOrThrow.mockResolvedValue({
    avatar_url: url,
    avatar_public_id: 'nailfolio/wrong',
  });
  await reconcileLegacyAvatarForUser_IO('user');
  expect(h.user.update).toHaveBeenCalledWith({
    where: { id: 'user' },
    data: { avatar_url: url, avatar_public_id: 'nailfolio/actual' },
  });
  expect(h.stylistAccount.update).toHaveBeenCalledWith({
    where: { account_id: 'stylist' },
    data: { avatar_public_id: 'nailfolio/actual' },
  });
});

it('repairs matching stale public ids without scheduling cleanup of the live URL', async () => {
  const url =
    'https://res.cloudinary.com/test/image/upload/v1/nailfolio/live.jpg';
  h.user.findUniqueOrThrow.mockResolvedValue({
    avatar_url: url,
    avatar_public_id: 'nailfolio/wrong',
  });
  h.stylistAccount.findUniqueOrThrow.mockResolvedValue({
    avatar_url: url,
    avatar_public_id: 'nailfolio/wrong',
  });
  await reconcileLegacyAvatarForUser_IO('user');
  expect(h.user.update).toHaveBeenCalledWith({
    where: { id: 'user' },
    data: { avatar_url: url, avatar_public_id: 'nailfolio/live' },
  });
  expect(h.stylistAccount.update).toHaveBeenCalledWith({
    where: { account_id: 'stylist' },
    data: { avatar_public_id: 'nailfolio/live' },
  });
  expect(h.cleanup).not.toHaveBeenCalled();
});

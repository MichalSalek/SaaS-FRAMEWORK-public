import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  userIndexed: vi.fn(),
  userUnparsed: vi.fn(),
  accountIndexed: vi.fn(),
  accountUnparsed: vi.fn(),
  resolveAccount: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      user: { findFirst: h.userIndexed, findMany: h.userUnparsed },
      stylistAccount: {
        findUnique: h.resolveAccount,
        findFirst: h.accountIndexed,
        findMany: h.accountUnparsed,
      },
      galleryRecord: { findFirst: async () => null, findMany: async () => [] },
      visitResultPhoto: {
        findFirst: async () => null,
        findMany: async () => [],
      },
    },
  },
}));
import { findForeignAssetOwner } from './cloudinary-asset.guard';
const URL =
  'https://res.cloudinary.com/demo/image/upload/v123/nailfolio/photo.jpg';
beforeEach(() => {
  vi.resetAllMocks();
  h.resolveAccount.mockResolvedValue(null);
  h.userIndexed.mockResolvedValue(null);
  h.userUnparsed.mockResolvedValue([]);
  h.accountIndexed.mockResolvedValue(null);
  h.accountUnparsed.mockResolvedValue([]);
});
describe('person and salon ownership', () => {
  it('allows a client-only owner when no foreign asset references exist', async () => {
    expect(await findForeignAssetOwner(URL, { userId: 'client' })).toBe('OWN');
    expect(h.resolveAccount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { created_by_user_id: 'client' } })
    );
  });
  it('rejects an indexed foreign user avatar', async () => {
    h.userIndexed.mockResolvedValue({ id: 'other' });
    expect(await findForeignAssetOwner(URL, { userId: 'client' })).toBe(
      'FOREIGN'
    );
    expect(h.userIndexed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { not: 'client' }, avatar_public_id: 'nailfolio/photo' },
      })
    );
  });
  it('rejects an indexed foreign salon logo', async () => {
    h.accountIndexed.mockImplementation(
      async (args: { where: Record<string, unknown> }) =>
        args.where.salon_logo_public_id !== undefined
          ? { account_id: 'other' }
          : null
    );
    expect(await findForeignAssetOwner(URL, { userId: 'client' })).toBe(
      'FOREIGN'
    );
  });
  it('rejects an unparseable foreign logo variant containing the same id', async () => {
    h.accountUnparsed.mockImplementation(
      async (args: { where: Record<string, unknown> }) =>
        'salon_logo_public_id' in args.where
          ? [
              {
                salon_logo_url:
                  'https://res.cloudinary.com/demo/image/upload/v123/nailfolio//photo.jpg',
              },
            ]
          : []
    );
    expect(await findForeignAssetOwner(URL, { userId: 'client' })).toBe(
      'FOREIGN'
    );
  });
  it('leaves a missing account for the calling operation to report', async () => {
    expect(await findForeignAssetOwner(URL, 'missing-account')).toBe('OWN');
    expect(h.userIndexed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { avatar_public_id: 'nailfolio/photo' },
      })
    );
    expect(h.accountIndexed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { salon_logo_public_id: 'nailfolio/photo' },
      })
    );
  });
  it('treats every user reference as foreign when an account owner cannot be resolved', async () => {
    h.userIndexed.mockResolvedValue({ id: 'victim' });
    expect(await findForeignAssetOwner(URL, 'missing-account')).toBe('FOREIGN');
    expect(h.userIndexed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { avatar_public_id: 'nailfolio/photo' },
      })
    );
  });
  it('treats every salon logo as foreign when an account owner cannot be resolved', async () => {
    h.accountIndexed.mockImplementation(
      async (args: { where: Record<string, unknown> }) =>
        args.where.salon_logo_public_id !== undefined
          ? { account_id: 'victim' }
          : null
    );
    expect(await findForeignAssetOwner(URL, 'missing-account')).toBe('FOREIGN');
    expect(h.accountIndexed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { salon_logo_public_id: 'nailfolio/photo' },
      })
    );
  });
  it('protects unparsed user references when the owner is unknown', async () => {
    h.userUnparsed.mockResolvedValue([
      {
        avatar_url:
          'https://res.cloudinary.com/demo/image/upload/v123/nailfolio//photo.jpg',
      },
    ]);
    expect(await findForeignAssetOwner(URL, 'missing-account')).toBe('FOREIGN');
    expect(h.userUnparsed).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { avatar_url: { not: null }, avatar_public_id: null },
      })
    );
  });
});

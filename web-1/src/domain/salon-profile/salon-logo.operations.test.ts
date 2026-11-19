import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const stylistAccount = { findUnique: vi.fn(), update: vi.fn() };
  return {
    stylistAccount,
    owner: vi.fn(),
    cleanup: vi.fn(),
    lock: vi.fn(async () => ({ account_id: 'salon' })),
  };
});
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      $transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ stylistAccount: h.stylistAccount }),
    },
  },
}));
vi.mock('@app/db/lock-rows', () => ({ lockStylistAccount: h.lock }));
vi.mock('@domain/_shared/guards/cloudinary-asset.guard', () => ({
  findForeignAssetOwner: h.owner,
}));
vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAsset: h.cleanup,
}));
import { setSalonLogo_IO } from './salon-logo.operations';
const OLD = 'https://res.cloudinary.com/test/image/upload/v1/nailfolio/old.jpg';
const NEW = 'https://res.cloudinary.com/test/image/upload/v1/nailfolio/new.jpg';
beforeEach(() => {
  vi.clearAllMocks();
  h.owner.mockResolvedValue('OWN');
  h.stylistAccount.findUnique.mockResolvedValue({
    created_by_user_id: 'owner',
    pricing_plan: 'STUDIO',
    subscription_status: 'ACTIVE',
    payment_status: 'PAID',
    account_status: 'ACTIVE',
    account_expiration_date: null,
    salon_logo_url: OLD,
  });
});
describe('salon logo', () => {
  it('sets only the logo columns after locking and verifying the owner and own plan', async () => {
    expect(
      (
        await setSalonLogo_IO({
          accountId: 'salon',
          userId: 'owner',
          logo_url: NEW,
        })
      ).success
    ).toBe(true);
    expect(h.stylistAccount.update).toHaveBeenCalledWith({
      where: { account_id: 'salon' },
      data: { salon_logo_url: NEW, salon_logo_public_id: 'nailfolio/new' },
    });
    expect(h.cleanup).toHaveBeenCalledWith(OLD);
  });
  it('rejects staff and free-plan owners after the locked recheck', async () => {
    expect(
      (
        await setSalonLogo_IO({
          accountId: 'salon',
          userId: 'staff',
          logo_url: null,
        })
      ).success
    ).toBe(false);
    h.stylistAccount.findUnique.mockResolvedValue({
      created_by_user_id: 'owner',
      pricing_plan: 'FREE',
      subscription_status: 'ACTIVE',
      payment_status: 'PAID',
      account_status: 'ACTIVE',
      account_expiration_date: null,
      salon_logo_url: OLD,
    });
    expect(
      (
        await setSalonLogo_IO({
          accountId: 'salon',
          userId: 'owner',
          logo_url: null,
        })
      ).success
    ).toBe(false);
    expect(h.stylistAccount.update).not.toHaveBeenCalled();
  });
  it('clears only logo data and leaves a same-url file alive', async () => {
    await setSalonLogo_IO({
      accountId: 'salon',
      userId: 'owner',
      logo_url: OLD,
    });
    expect(h.cleanup).not.toHaveBeenCalled();
    expect(h.stylistAccount.update).not.toHaveBeenCalled();
    await setSalonLogo_IO({
      accountId: 'salon',
      userId: 'owner',
      logo_url: null,
    });
    expect(h.stylistAccount.update).toHaveBeenCalledWith({
      where: { account_id: 'salon' },
      data: { salon_logo_url: null, salon_logo_public_id: null },
    });
    expect(h.cleanup).toHaveBeenCalledWith(OLD);
  });
  it('rejects foreign media before changing a logo', async () => {
    h.owner.mockResolvedValue('FOREIGN');
    expect(
      (
        await setSalonLogo_IO({
          accountId: 'salon',
          userId: 'owner',
          logo_url: NEW,
        })
      ).success
    ).toBe(false);
    expect(h.stylistAccount.update).not.toHaveBeenCalled();
  });
});

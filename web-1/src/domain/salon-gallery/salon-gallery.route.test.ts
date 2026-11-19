import { describe, expect, it, vi } from 'vitest';
import handler from '../../pages/api/v1/salon/gallery/index';
import {
  makeCurrentUserOutput,
  makeStylistCurrentUser,
} from '../../test-utils/fixtures';
import { mockApiHandler, mockDb } from '../../test-utils/mockApiHandler';
import { __setCurrentUser } from '../../test-utils/setup';

const owner = {
  account_id: 'salon',
  created_by_user_id: 'owner',
  pricing_plan: 'STUDIO',
  subscription_status: 'ACTIVE',
  payment_status: 'PAID',
  account_status: 'ACTIVE',
  account_expiration_date: null,
  salon_profile_name: 'Salon',
  display_name: 'Owner',
  avatar_url: null,
  vanity_url: null,
  created_by_user: { image: null, avatar_url: null },
};

describe('team gallery route', () => {
  it('returns works to an authenticated, accepted team stylist', async () => {
    const viewer = makeStylistCurrentUser();
    __setCurrentUser(makeCurrentUserOutput(viewer));
    const findMember = vi.fn(async () => ({ id: 'membership' }));
    mockDb({
      impersonationBackup: { findFirst: async () => null },
      stylistAccount: {
        findFirst: async () => owner,
        findMany: async () => [],
      },
      staffMember: { findFirst: findMember },
      galleryRecord: { findMany: async () => [] },
    });
    const result = await mockApiHandler(handler, {
      method: 'GET',
      url: '/api/v1/salon/gallery',
      query: { salon_account_id: 'salon' },
    });
    expect(result.status).toBe(200);
    expect(result.event).toBe('SALON_PROFILE_FETCHED');
    expect(findMember).toHaveBeenCalledWith({
      where: {
        user_id: viewer.id,
        stylist_account_id: 'salon',
        is_active: true,
        accepted_at: { not: null },
      },
      select: { id: true },
    });
    expect(result.data).toEqual(
      expect.objectContaining({
        salon_account_id: 'salon',
        records: [],
        nextCursor: null,
      })
    );
  });
  it('does not serve the gallery after the salon plan ends', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    mockDb({
      impersonationBackup: { findFirst: async () => null },
      stylistAccount: {
        findFirst: async () => ({
          ...owner,
          pricing_plan: 'FREE',
          subscription_status: 'CANCELED',
          payment_status: 'UNPAID',
        }),
      },
    });
    const result = await mockApiHandler(handler, {
      method: 'GET',
      url: '/api/v1/salon/gallery',
      query: { salon_account_id: 'salon' },
    });
    expect(result.status).toBe(404);
    expect(result.event).toBe('ACCOUNT_NOT_FOUND');
  });
});

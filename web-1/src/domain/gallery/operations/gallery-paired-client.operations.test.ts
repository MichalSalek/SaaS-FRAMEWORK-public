/**
 * Paired-client gallery: getGalleryForPairedClient_IO.
 *
 *  - the pinned block comes first, in the order the stylist chose in her pin manager
 *    (the shared PINNED_GALLERY_RECORD_ORDER_BY the public profile reads), then the
 *    rest newest first; the page is scoped to the stylist and drops hidden records;
 *  - no access (no active pair or salon-derived access) → PAIRING_SESSION_NOT_FOUND;
 *  - a stylist that is not publicly visible → STYLIST_NOT_FOUND, before any gallery read.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getGalleryForPairedClient_IO } from './gallery-paired-client.operations';
import { PINNED_GALLERY_RECORD_ORDER_BY } from '@domain/gallery/gallery-record-visibility';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const salonAccess = vi.hoisted(() => ({ value: true }));

vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: vi.fn(async () => salonAccess.value),
}));

vi.mock('@app/pricing/effective-plan.resolver', () => ({
  resolveEffectivePlan_IO: vi.fn(async () => ({
    effective_pricing_plan: 'FREE',
  })),
}));

const STYLIST_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000002';

const account = {
  account_id: STYLIST_ID,
  display_name: 'Test Stylist',
  business_name: null,
  address_city: 'Warszawa',
  pricing_plan: PricingPlanValue.FREE,
  created_by_user_id: 'usr_stylist',
  brand_accent_color: null,
};

const makeRecord = (id: string, isPinned: boolean) => ({
  gallery_record_id: id,
  asset_url: `https://res.cloudinary.com/test/image/upload/v1/${id}.jpg`,
  is_pinned: isPinned,
  nail_length: NAIL_LENGTHS.MEDIUM,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  colors: [],
  traits: [],
});

const mockScenario = (stylist: typeof account | null = account) => {
  const records = [makeRecord('gr_2', true), makeRecord('gr_1', false)];
  const findMany = vi.fn(async (_arg: unknown) => records);
  const count = vi.fn(async (_arg: unknown) => records.length);
  mockDb({
    stylistAccount: { findFirst: vi.fn(async () => stylist) },
    galleryRecord: { findMany, count },
  });
  return { findMany, count };
};

const call = () =>
  getGalleryForPairedClient_IO({
    props: { stylist_account_id: STYLIST_ID, limit: 100, offset: 0 },
    currentUserId: CLIENT_USER_ID,
  });

describe('getGalleryForPairedClient_IO', () => {
  beforeEach(() => {
    salonAccess.value = true;
  });

  it('orders the pinned block by the stylist-chosen position, then the rest newest first', async () => {
    const { findMany } = mockScenario();

    const result = await call();

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      orderBy: unknown[];
      take: number;
      skip: number;
    };
    expect(arg.orderBy).toEqual([
      { is_pinned: 'desc' },
      ...PINNED_GALLERY_RECORD_ORDER_BY,
    ]);
    expect(arg.orderBy[1]).toEqual({
      pinned_position: { sort: 'asc', nulls: 'last' },
    });
    expect(arg.where).toEqual({
      created_by_account_id: STYLIST_ID,
      is_hidden: false,
    });
    expect(arg.take).toBe(100);
    expect(arg.skip).toBe(0);
    if (result.success) {
      expect(result.data.records.map(r => r.gallery_record_id)).toEqual([
        'gr_2',
        'gr_1',
      ]);
      expect(result.data.total_count).toBe(2);
    }
  });

  it('without access returns PAIRING_SESSION_NOT_FOUND and reads no gallery', async () => {
    salonAccess.value = false;
    const { findMany } = mockScenario();

    const result = await call();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIRING_SESSION_NOT_FOUND');
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('a stylist that is not publicly visible returns STYLIST_NOT_FOUND', async () => {
    const { findMany } = mockScenario(null);

    const result = await call();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('STYLIST_NOT_FOUND');
    }
    expect(findMany).not.toHaveBeenCalled();
  });
});

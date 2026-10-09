/**
 * getUsageStats_IO — `pinned_records` counts the SAME set the pin gate enforces.
 *
 * The pin quota (gallery-pin.operations.ts) and the dashboard `pinned_count` count
 * VISIBLE pins only (`is_pinned && !is_hidden`); a pin hidden by moderation frees its
 * slot. The usage tile used to count every `is_pinned` row, so the frontend
 * PinnedManager disabled pinning while the gate would still accept one. The count
 * stub applies the WHERE to fixture rows (behavioral, not a literal snapshot), so
 * dropping the visibility filter fails this test.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { getUsageStats_IO } from './user-query.operations';

const USER_ID = 'usr_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';

type GalleryRow = {
  created_by_account_id: string;
  is_pinned: boolean;
  is_hidden: boolean;
};

const GALLERY_ROWS: readonly GalleryRow[] = [
  {
    created_by_account_id: STYLIST_ACCOUNT_ID,
    is_pinned: true,
    is_hidden: false,
  },
  {
    created_by_account_id: STYLIST_ACCOUNT_ID,
    is_pinned: true,
    is_hidden: false,
  },
  // Pinned, then hidden by moderation: stays is_pinned in the DB, frees its slot.
  {
    created_by_account_id: STYLIST_ACCOUNT_ID,
    is_pinned: true,
    is_hidden: true,
  },
  {
    created_by_account_id: STYLIST_ACCOUNT_ID,
    is_pinned: false,
    is_hidden: false,
  },
];

const behavioralCount = vi.fn(
  async (arg: { where: Partial<Record<keyof GalleryRow, unknown>> }) =>
    GALLERY_ROWS.filter(row =>
      Object.entries(arg.where).every(
        ([key, value]) => row[key as keyof GalleryRow] === value
      )
    ).length
);

const zero = async () => 0;

describe('getUsageStats_IO — pinned_records', () => {
  it('excludes a pinned record hidden by moderation', async () => {
    mockDb({
      galleryRecord: { count: behavioralCount },
      favoriteStylist: { count: zero },
      clientStylistPair: { count: zero },
      sessionContainer: { count: zero },
      favoriteGalleryRecord: { count: zero },
    });

    const result = await getUsageStats_IO({
      userId: USER_ID,
      stylistAccountId: STYLIST_ACCOUNT_ID,
      pricingPlan: PricingPlanValue.FREE,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.pinned_records).toBe(2);
    // The unfiltered gallery total still counts every own record.
    expect(result.data.gallery_records).toBe(GALLERY_ROWS.length);
  });
});

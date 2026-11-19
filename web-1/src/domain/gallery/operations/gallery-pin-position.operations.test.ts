/**
 * Pin and the public order: a new pin is appended at the END of the stylist's
 * order (max position of her pinned records + 1, 0 for the first pin). Unpin
 * clearing the position is asserted in gallery-pin.operations.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { pinGalleryRecord_IO } from './gallery-pin.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const ACCOUNT_ID = 'acc_test_0000000000000001';
const RECORD_ID = 'gr_test_0000000000000001';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const mockPin = (maxPosition: number | null) => {
  const aggregate = vi.fn(async (_arg: unknown) => ({
    _max: { pinned_position: maxPosition },
  }));
  const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
  mockDb({
    galleryRecord: {
      findUnique: async () => ({
        created_by_account_id: ACCOUNT_ID,
        is_pinned: false,
        is_hidden: false,
      }),
      count: async () => 0,
      aggregate,
      updateMany,
    },
    $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
  });
  return { aggregate, updateMany };
};

const pinArgs = {
  gallery_record_id: RECORD_ID,
  stylist_account_id: ACCOUNT_ID,
  pricing_plan: PricingPlanValue.PRO,
};

describe('pinGalleryRecord_IO — position in the public order', () => {
  it('appends after the last pinned work of the SAME account', async () => {
    const { aggregate, updateMany } = mockPin(4);

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(true);
    const aggArg = aggregate.mock.calls[0]?.[0] as { where: unknown };
    expect(aggArg.where).toEqual({
      created_by_account_id: ACCOUNT_ID,
      is_pinned: true,
    });
    const arg = updateMany.mock.calls[0]?.[0] as { data: unknown };
    expect(arg.data).toEqual({ is_pinned: true, pinned_position: 5 });
  });

  it('the first pin of an account gets position 0', async () => {
    const { updateMany } = mockPin(null);

    await pinGalleryRecord_IO(pinArgs);

    const arg = updateMany.mock.calls[0]?.[0] as {
      data: { pinned_position: number };
    };
    expect(arg.data.pinned_position).toBe(0);
  });
});

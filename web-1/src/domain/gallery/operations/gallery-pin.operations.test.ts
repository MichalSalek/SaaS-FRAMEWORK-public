/**
 * Gallery-pin unit tests: pinGalleryRecord_IO / unpinGalleryRecord_IO against a mocked DB.
 *
 *  - happy path: atomic updateMany WHERE {record, is_pinned:false, owner}, post-verify recount;
 *  - already pinned is resolved BEFORE the quota gate (400 ALREADY_PINNED, not 403 LIMIT_REACHED);
 *  - quota per plan (FREE=3): at the limit the updateMany never runs;
 *  - anti-enumeration: a foreign record gives GALLERY_RECORD_NOT_FOUND, never OWNERSHIP;
 *  - race-loser tail: count=0 plus re-fetch distinguishes vanished (404) from concurrent-pin-won;
 *  - recount > limit: sentinel rollback mapped to GALLERY_PIN_LIMIT_REACHED, not DATABASE_ERROR;
 *  - a hidden (moderated) record cannot be pinned (404 mask); the quota counts VISIBLE pins only;
 *  - unpin: atomic updateMany like pin, ownership mask, NOT_PINNED branch, fresh pinnedCount,
 *    record vanished mid-tx gives GALLERY_RECORD_NOT_FOUND.
 * The mocked DB cannot show real interleavings; see tests/concurrency for the live ones.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  pinGalleryRecord_IO,
  unpinGalleryRecord_IO,
} from './gallery-pin.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const ACCOUNT_ID = 'acc_test_0000000000000001';
const OTHER_ACCOUNT_ID = 'acc_test_9999999999999999';
const RECORD_ID = 'gr_test_0000000000000001';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

type TargetRow = {
  created_by_account_id: string;
  is_pinned: boolean;
  is_hidden: boolean;
} | null;

const mockPinScenario = ({
  target = {
    created_by_account_id: ACCOUNT_ID,
    is_pinned: false,
    is_hidden: false,
  } as TargetRow,
  counts = [0, 1] as number[],
  updatedCount = 1,
} = {}) => {
  const findUnique = vi.fn(async (): Promise<TargetRow> => target);
  // Next position: covered in gallery-pin-position.operations.test.ts.
  const aggregate = async () => ({ _max: { pinned_position: null } });
  const count = vi.fn(async (_arg: unknown) => 0);
  for (const value of counts) {
    count.mockResolvedValueOnce(value);
  }
  const updateMany = vi.fn(async (_arg: unknown) => ({ count: updatedCount }));
  mockDb({
    galleryRecord: { findUnique, count, updateMany, aggregate },
    // lockStylistAccount (FOR UPDATE): its result is deliberately ignored by the op.
    $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
  });
  return { findUnique, count, updateMany };
};

const pinArgs = {
  gallery_record_id: RECORD_ID,
  stylist_account_id: ACCOUNT_ID,
  pricing_plan: PricingPlanValue.FREE,
};

describe('pinGalleryRecord_IO — atomic pin + quota + mask', () => {
  it('happy path: updateMany scoped by record+unpinned+OWNER, returns pinnedCount+1', async () => {
    const { updateMany } = mockPinScenario({ counts: [1, 2] });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pinnedCount).toBe(2);
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]?.[0] as {
      where: {
        gallery_record_id: string;
        is_pinned: boolean;
        created_by_account_id: string;
      };
      data: { is_pinned: boolean };
    };
    // All three WHERE keys — the atomic guard against races AND foreign records.
    expect(arg.where.gallery_record_id).toBe(RECORD_ID);
    expect(arg.where.is_pinned).toBe(false);
    expect(arg.where.created_by_account_id).toBe(ACCOUNT_ID);
    expect(arg.data.is_pinned).toBe(true);
  });

  it('record not found → GALLERY_RECORD_NOT_FOUND, no updateMany', async () => {
    const { updateMany } = mockPinScenario({ target: null });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('foreign record → SAME GALLERY_RECORD_NOT_FOUND (anti-enumeration mask), no updateMany', async () => {
    const { updateMany } = mockPinScenario({
      target: {
        created_by_account_id: OTHER_ACCOUNT_ID,
        is_pinned: false,
        is_hidden: false,
      },
    });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('re-pin of an already-pinned record → ALREADY_PINNED and the quota count is NEVER read (finding pin-1)', async () => {
    const { count, updateMany } = mockPinScenario({
      target: {
        created_by_account_id: ACCOUNT_ID,
        is_pinned: true,
        is_hidden: false,
      },
    });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      // NOT a quota problem — the slot is already consumed by THIS record.
      expect(result.error.type).toBe('GALLERY_RECORD_ALREADY_PINNED');
    }
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rekord ukryty moderacyjnie → GALLERY_RECORD_NOT_FOUND, slot planu NIE jest zjadany', async () => {
    const { count, updateMany } = mockPinScenario({
      target: {
        created_by_account_id: ACCOUNT_ID,
        is_pinned: false,
        is_hidden: true,
      },
    });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      // The same mask as a foreign or missing record: on the public surface this pin serves, a hidden
      // record does not exist.
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    // Without the fix: 200 SUCCESS, is_pinned=true and zero records on the public profile.
    expect(count).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('kwota pinów liczy TYLKO widoczne rekordy (parytet z wizytówką i kaflem zużycia)', async () => {
    const { count, updateMany } = mockPinScenario({ counts: [1, 2] });

    await pinGalleryRecord_IO(pinArgs);

    const countArg = count.mock.calls[0]?.[0] as {
      where: {
        created_by_account_id: string;
        is_pinned: boolean;
        is_hidden: boolean;
      };
    };
    expect(countArg.where.created_by_account_id).toBe(ACCOUNT_ID);
    expect(countArg.where.is_pinned).toBe(true);
    expect(countArg.where.is_hidden).toBe(false);
    // The atomic gate carries the same precondition.
    const updateArg = updateMany.mock.calls[0]?.[0] as {
      where: { is_hidden: boolean };
    };
    expect(updateArg.where.is_hidden).toBe(false);
  });

  it('FREE quota reached (pinned=3/3) → GALLERY_PIN_LIMIT_REACHED, updateMany never runs', async () => {
    const { updateMany } = mockPinScenario({ counts: [3] });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_PIN_LIMIT_REACHED');
      if (result.error.type === 'GALLERY_PIN_LIMIT_REACHED') {
        expect(result.error.currentPinned).toBe(3);
        expect(result.error.limit).toBe(3);
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('PRO plan (limit 10): pinned=3 passes the FREE-blocking count', async () => {
    mockPinScenario({ counts: [3, 4] });

    const result = await pinGalleryRecord_IO({
      ...pinArgs,
      pricing_plan: PricingPlanValue.PRO,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pinnedCount).toBe(4);
    }
  });

  it('race-loser (updateMany count=0), record vanished on re-fetch → GALLERY_RECORD_NOT_FOUND', async () => {
    const { findUnique } = mockPinScenario({
      counts: [1],
      updatedCount: 0,
    });
    findUnique
      .mockResolvedValueOnce({
        created_by_account_id: ACCOUNT_ID,
        is_pinned: false,
        is_hidden: false,
      })
      .mockResolvedValueOnce(null);

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });

  it('race-loser (updateMany count=0), concurrent pin won → GALLERY_RECORD_ALREADY_PINNED', async () => {
    const { findUnique } = mockPinScenario({
      counts: [1],
      updatedCount: 0,
    });
    findUnique
      .mockResolvedValueOnce({
        created_by_account_id: ACCOUNT_ID,
        is_pinned: false,
        is_hidden: false,
      })
      .mockResolvedValueOnce({
        created_by_account_id: ACCOUNT_ID,
        is_pinned: true,
        is_hidden: false,
      });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_ALREADY_PINNED');
    }
  });

  it('post-verify quota race: recount > limit → rollback sentinel mapped to GALLERY_PIN_LIMIT_REACHED', async () => {
    mockPinScenario({ counts: [2, 5], updatedCount: 1 });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Sentinel throw classified in the outer catch — never DATABASE_ERROR.
      expect(result.error.type).toBe('GALLERY_PIN_LIMIT_REACHED');
    }
  });

  it('unknown DB throw → DATABASE_ERROR', async () => {
    mockDb({
      galleryRecord: {
        findUnique: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
      $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
    });

    const result = await pinGalleryRecord_IO(pinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

const unpinArgs = {
  gallery_record_id: RECORD_ID,
  stylist_account_id: ACCOUNT_ID,
};

const mockUnpinScenario = ({
  record = {
    created_by_account_id: ACCOUNT_ID,
    is_pinned: true,
    is_hidden: false,
  } as TargetRow,
  remainingPinned = 2,
  updatedCount = 1,
} = {}) => {
  const findUnique = vi.fn(async (): Promise<TargetRow> => record);
  const updateMany = vi.fn(async (_arg: unknown) => ({ count: updatedCount }));
  const count = vi.fn(async (_arg: unknown) => remainingPinned);
  mockDb({
    galleryRecord: { findUnique, updateMany, count },
    // lockStylistAccount (FOR UPDATE): unpin takes the same lock as pin.
    $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
  });
  return { findUnique, updateMany, count };
};

describe('unpinGalleryRecord_IO — unpin + mask', () => {
  it('happy path: atomowy updateMany (rekord+przypięty+OWNER) i FRESH pinnedCount', async () => {
    const { updateMany, count } = mockUnpinScenario({ remainingPinned: 2 });

    const result = await unpinGalleryRecord_IO(unpinArgs);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pinnedCount).toBe(2);
    }
    const updateArg = updateMany.mock.calls[0]?.[0] as {
      where: {
        gallery_record_id: string;
        is_pinned: boolean;
        created_by_account_id: string;
      };
      data: { is_pinned: boolean };
    };
    expect(updateArg.where.gallery_record_id).toBe(RECORD_ID);
    // The full precondition in one SQL statement = one 200 per state change.
    expect(updateArg.where.is_pinned).toBe(true);
    expect(updateArg.where.created_by_account_id).toBe(ACCOUNT_ID);
    // An unpinned work leaves the order; a later re-pin appends at the end.
    expect(updateArg.data).toEqual({ is_pinned: false, pinned_position: null });
    // The count is scoped to the OWNER's VISIBLE pinned records.
    const countArg = count.mock.calls[0]?.[0] as unknown as {
      where: {
        created_by_account_id: string;
        is_pinned: boolean;
        is_hidden: boolean;
      };
    };
    expect(countArg.where.created_by_account_id).toBe(ACCOUNT_ID);
    expect(countArg.where.is_pinned).toBe(true);
    expect(countArg.where.is_hidden).toBe(false);
  });

  it('przegrany wyścig unpinów → 400 NOT_PINNED, NIE drugie 200 na jedno przejście', async () => {
    // updateMany count=0 for a record that is still ours and already unpinned.
    const { findUnique } = mockUnpinScenario({ updatedCount: 0 });
    findUnique.mockResolvedValue({
      created_by_account_id: ACCOUNT_ID,
      is_pinned: false,
      is_hidden: false,
    });

    const result = await unpinGalleryRecord_IO(unpinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Without the fix a burst of 4 unpins gave 2x200 SUCCESS for ONE state change, with a
      // pinnedCount taken after another commit.
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_PINNED');
    }
  });

  it('record not found → GALLERY_RECORD_NOT_FOUND', async () => {
    const { updateMany } = mockUnpinScenario({ record: null });

    const result = await unpinGalleryRecord_IO(unpinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('foreign record → SAME GALLERY_RECORD_NOT_FOUND (anti-enumeration mask), no update', async () => {
    const { updateMany } = mockUnpinScenario({
      record: {
        created_by_account_id: OTHER_ACCOUNT_ID,
        is_pinned: true,
        is_hidden: false,
      },
    });

    const result = await unpinGalleryRecord_IO(unpinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('record not pinned → GALLERY_RECORD_NOT_PINNED, no update', async () => {
    const { updateMany } = mockUnpinScenario({
      record: {
        created_by_account_id: ACCOUNT_ID,
        is_pinned: false,
        is_hidden: false,
      },
    });

    const result = await unpinGalleryRecord_IO(unpinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_PINNED');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rekord skasowany w locie (updateMany count=0, re-fetch pusty) → GALLERY_RECORD_NOT_FOUND, nie 500', async () => {
    // updateMany (unlike update) does not throw P2025, so one read resolves the TOCTOU window: the
    // same 404 mask as the find-stage branch.
    const { findUnique } = mockUnpinScenario({ updatedCount: 0 });
    findUnique
      .mockResolvedValueOnce({
        created_by_account_id: ACCOUNT_ID,
        is_pinned: true,
        is_hidden: false,
      })
      .mockResolvedValueOnce(null);

    const result = await unpinGalleryRecord_IO(unpinArgs);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });
});

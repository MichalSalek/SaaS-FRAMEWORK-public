/**
 * Gallery-explore unit tests — exploreGalleryRecords_IO (cross-stylist feed).
 *
 * Locks in the explore contract:
 *
 *  - baseline WHERE always carries the moderation mask (is_hidden:false), the
 *    is_pinned:true public-pinned-only gate (DOMAIN_SSOT §4.4 — Explore = public
 *    pinned only; unpinned records are pairing-gated §4.2, must NOT leak to the
 *    feed) AND the full STYLIST_PUBLICLY_VISIBLE pair on created_by_account —
 *    hidden/unpinned records and records of deactivated/soft-deleted stylists
 *    never enter the feed;
 *  - uniform cursor contract: malformed format → 400-shaped VALIDATION_ERROR
 *    before any DB access; stale cursor → explicit existence pre-check (findMany
 *    would silently return []); valid cursor → { cursor, skip:1 };
 *  - LIKE-escape of user input: city (equals/insensitive) and searchQuery
 *    (contains OR-fan) get `%`/`_` escaped — a bare `%` must not match-all;
 *  - take clamp [1,50] fetched as take+1; hasMore/nextCursor pagination;
 *  - strict vs loose color filter (AND of some vs single `in`);
 *  - mapping: like_count = _count.favorited_by, is_favorited = per-viewer
 *    favorited_by, show_watermark for FREE-plan owners.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { exploreGalleryRecords_IO } from './gallery-explore.query';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';

const VIEWER_USER_ID = 'usr_viewer_00000000001';
// isValidCursorFormat: /^[a-z0-9]{20,40}$/
const VALID_CURSOR = 'abc123abc123abc123abc123';

const makeRecord = (
  id: string,
  {
    plan = PricingPlanValue.PRO as string,
    favoritedBy = [] as Array<{ id: string }>,
    likeCount = 0,
  } = {}
) => ({
  gallery_record_id: id,
  asset_url: `https://res.cloudinary.com/test/image/upload/v1/${id}.jpg`,
  nail_length: NAIL_LENGTHS.MEDIUM,
  is_pinned: false,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  colors: [],
  traits: [],
  created_by_account: {
    account_id: 'acc_test_0000000000000001',
    display_name: 'Test Salon',
    vanity_url: null,
    address_city: 'Warszawa',
    pricing_plan: plan,
  },
  favorited_by: favoritedBy,
  _count: { favorited_by: likeCount },
});

const mockScenario = ({
  records = [makeRecord('gr1record00000000001')] as ReturnType<
    typeof makeRecord
  >[],
  cursorExists = true,
} = {}) => {
  const findMany = vi.fn(async (_arg: unknown) => records);
  const findUnique = vi.fn(async () =>
    cursorExists ? { gallery_record_id: VALID_CURSOR } : null
  );
  mockDb({ galleryRecord: { findMany, findUnique } });
  return { findMany, findUnique };
};

describe('exploreGalleryRecords_IO — cross-stylist feed + masks + cursor', () => {
  it('baseline WHERE: is_hidden mask + full STYLIST_PUBLICLY_VISIBLE on the owner account', async () => {
    const { findMany } = mockScenario();

    const result = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
    });

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as {
      where: {
        is_hidden: boolean;
        is_pinned: boolean;
        created_by_account: {
          account_status: string;
          created_by_user: { is_active: boolean };
        };
      };
      take: number;
    };
    expect(arg.where.is_hidden).toBe(false);
    // Explore = public PINNED only (DOMAIN_SSOT §4.4). Unpinned records are
    // pairing-gated (§4.2) and must never reach the cross-stylist feed
    // (finding gallery-explore-unpinned). Locks the is_pinned:true gate.
    expect(arg.where.is_pinned).toBe(true);
    expect(arg.where.created_by_account.account_status).toBe(
      AccountStatusValue.ACTIVE
    );
    expect(arg.where.created_by_account.created_by_user).toEqual({
      is_active: true,
    });
    // Default take 30 → fetched as 31 (hasMore sentinel).
    expect(arg.take).toBe(31);
  });

  it('take clamped to [1,50]: 500 → 51, 0 → 2', async () => {
    const { findMany } = mockScenario();
    await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      take: 500,
    });
    await exploreGalleryRecords_IO({ currentUserId: VIEWER_USER_ID, take: 0 });

    expect((findMany.mock.calls[0]?.[0] as { take: number }).take).toBe(51);
    expect((findMany.mock.calls[1]?.[0] as { take: number }).take).toBe(2);
  });

  it('malformed cursor → VALIDATION_ERROR before ANY DB access', async () => {
    const { findMany, findUnique } = mockScenario();

    const result = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      cursor: 'NOT-A-CUID!\0',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('cursor');
      }
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('stale cursor → VALIDATION_ERROR via existence pre-check (never a silent empty page)', async () => {
    const { findMany } = mockScenario({ cursorExists: false });

    const result = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      cursor: VALID_CURSOR,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('cursor');
      }
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('valid cursor → findMany receives { cursor, skip:1 }', async () => {
    const { findMany } = mockScenario();

    const result = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      cursor: VALID_CURSOR,
    });

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as {
      cursor: { gallery_record_id: string };
      skip: number;
    };
    expect(arg.cursor).toEqual({ gallery_record_id: VALID_CURSOR });
    expect(arg.skip).toBe(1);
  });

  it('city filter: LIKE-escaped, case-insensitive equality on the stylist account', async () => {
    const { findMany } = mockScenario();

    await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      city: '  War%szawa  ',
    });

    const arg = findMany.mock.calls[0]?.[0] as {
      where: {
        created_by_account: {
          address_city: { equals: string; mode: string };
        };
      };
    };
    // Trimmed + `%` escaped — a wildcard city must match literally, not match-all.
    expect(arg.where.created_by_account.address_city.equals).toBe(
      'War\\%szawa'
    );
    expect(arg.where.created_by_account.address_city.mode).toBe('insensitive');
  });

  it('searchQuery: `%` escaped in EVERY OR branch (no wildcard match-all)', async () => {
    const { findMany } = mockScenario();

    await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      searchQuery: '100%',
    });

    const arg = findMany.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(arg.where.OR).toHaveLength(5);
    expect(arg.where.OR[0]).toEqual({
      created_by_account: {
        display_name: { contains: '100\\%', mode: 'insensitive' },
      },
    });
    expect(arg.where.OR[3]).toEqual({
      colors: {
        some: {
          color: { name: { contains: '100\\%', mode: 'insensitive' } },
        },
      },
    });
  });

  it('strict color filter → AND of per-id some; loose → single `in` some', async () => {
    const { findMany } = mockScenario();

    await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      color_ids: ['color_1', 'color_2'],
      apply_strict_filter: true,
    });
    await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      color_ids: ['color_1', 'color_2'],
      apply_strict_filter: false,
    });

    const strictArg = findMany.mock.calls[0]?.[0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(strictArg.where.AND).toEqual([
      { colors: { some: { color_id: 'color_1' } } },
      { colors: { some: { color_id: 'color_2' } } },
    ]);
    const looseArg = findMany.mock.calls[1]?.[0] as {
      where: { colors: { some: { color_id: { in: string[] } } } };
    };
    expect(looseArg.where.colors.some.color_id.in).toEqual([
      'color_1',
      'color_2',
    ]);
  });

  it('pagination: take+1 rows → sliced page + nextCursor = last page item; fewer rows → null', async () => {
    const rows = [
      makeRecord('gr1record00000000001'),
      makeRecord('gr2record00000000002'),
      makeRecord('gr3record00000000003'),
    ];
    mockScenario({ records: rows });

    const hasMoreResult = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      take: 2,
    });
    expect(hasMoreResult.success).toBe(true);
    if (hasMoreResult.success) {
      expect(hasMoreResult.data.records).toHaveLength(2);
      expect(hasMoreResult.data.nextCursor).toBe('gr2record00000000002');
    }

    mockScenario({ records: [makeRecord('gr1record00000000001')] });
    const endResult = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
      take: 2,
    });
    expect(endResult.success).toBe(true);
    if (endResult.success) {
      expect(endResult.data.nextCursor).toBeNull();
    }
  });

  it('mapping: like_count from _count, is_favorited per-viewer, watermark for FREE owners; favorited_by scoped to viewer', async () => {
    const { findMany } = mockScenario({
      records: [
        makeRecord('gr1record00000000001', {
          plan: PricingPlanValue.FREE,
          favoritedBy: [{ id: 'fav_1' }],
          likeCount: 7,
        }),
      ],
    });

    const result = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const record = result.data.records[0];
      expect(record?.like_count).toBe(7);
      expect(record?.is_favorited).toBe(true);
      expect(record?.show_watermark).toBe(true);
      expect(record?.created_by_account.account_id).toBe(
        'acc_test_0000000000000001'
      );
    }
    // The per-viewer favorite sub-select is scoped to the CURRENT user.
    const arg = findMany.mock.calls[0]?.[0] as {
      include: { favorited_by: { where: { client_user_id: string } } };
    };
    expect(arg.include.favorited_by.where.client_user_id).toBe(VIEWER_USER_ID);
  });

  it('unknown DB throw → DATABASE_ERROR', async () => {
    const { findMany } = mockScenario();
    findMany.mockImplementation(async () => {
      throw new Error('connection reset');
    });

    const result = await exploreGalleryRecords_IO({
      currentUserId: VIEWER_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

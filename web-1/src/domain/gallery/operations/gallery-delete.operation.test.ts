/**
 * Gallery-delete unit tests — deleteGalleryRecord_IO.
 *
 * Locks in the delete contract (D7 + visibility-gated decrements + anti-enumeration):
 *
 *  - happy path (visible record): delete + FLOORED cached_gallery_count decrement
 *    (by 1) + cached_likes_count decrement by the PRE-delete likeCount — all in the
 *    same tx; Cloudinary asset cleanup fires AFTER a successful delete;
 *  - visible record with 0 likes: gallery-count decrement only (no likes decrement);
 *  - hidden record (is_hidden=true): delete WITHOUT any decrement — moderation HIDE
 *    already removed it (and its likes) from the counters; an unconditional decrement
 *    would double-subtract (finding gallery-count-double-decrement);
 *  - NOT_FOUND → GALLERY_RECORD_NOT_FOUND, no delete, no cleanup;
 *  - foreign record (ownership) → SAME GALLERY_RECORD_NOT_FOUND (anti-enumeration
 *    mask, never OWNERSHIP_ERROR), and crucially NO delete happened;
 *  - missing params → VALIDATION_ERROR; unknown DB throw → DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { deleteGalleryRecord_IO } from './gallery-delete.operation';
import { cleanupCloudinaryAsset } from './gallery-cloudinary-cleanup';

vi.mock('./gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAsset: vi.fn(),
  cleanupCloudinaryAssets: vi.fn(),
}));

const ACCOUNT_ID = 'acc_test_0000000000000001';
const OTHER_ACCOUNT_ID = 'acc_test_9999999999999999';
const RECORD_ID = 'gr_test_0000000000000001';
const OP_ID = 'op_test_0000000000000001';
const ASSET_URL =
  'https://res.cloudinary.com/test/image/upload/v1/nailfolio/photo.jpg';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const args = {
  gallery_record_id: RECORD_ID,
  id: OP_ID,
  account_id: ACCOUNT_ID,
};

const mockScenario = ({
  owner = ACCOUNT_ID as string,
  isHidden = false,
  likeCount = 0,
  exists = true,
} = {}) => {
  const findUnique = vi.fn(async () =>
    exists
      ? {
          created_by_account_id: owner,
          asset_url: ASSET_URL,
          is_hidden: isHidden,
        }
      : null
  );
  const deleteFn = vi.fn(async (_arg: unknown) => ({
    gallery_record_id: RECORD_ID,
  }));
  const favCount = vi.fn(async () => likeCount);
  const executeRaw = vi.fn(async () => 1);
  mockDb({
    galleryRecord: { findUnique, delete: deleteFn },
    favoriteGalleryRecord: { count: favCount },
    // lockStylistAccount robi tx.$queryRaw (FOR UPDATE) — wynik ignorowany przez op.
    $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
    $executeRaw: rawStub(executeRaw),
  });
  return { findUnique, deleteFn, favCount, executeRaw };
};

/** Extract [joined SQL, by, accountId] tuples from the $executeRaw spy. */
const rawCalls = (
  executeRaw: ReturnType<typeof vi.fn>
): Array<{ sql: string; by: number; accountId: string }> =>
  (
    executeRaw.mock.calls as unknown as Array<
      [readonly string[], number, string]
    >
  ).map(call => ({ sql: call[0].join(''), by: call[1], accountId: call[2] }));

describe('deleteGalleryRecord_IO — delete + visibility-gated decrements + mask', () => {
  it('visible record with likes: delete + floored gallery-count decrement (1) + likes decrement (likeCount) + cleanup', async () => {
    const { deleteFn, executeRaw } = mockScenario({ likeCount: 3 });

    const result = await deleteGalleryRecord_IO(args);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ deleted: true });
    }
    expect(deleteFn).toHaveBeenCalledTimes(1);
    const deleteArg = deleteFn.mock.calls[0]?.[0] as unknown as {
      where: { gallery_record_id: string };
    };
    expect(deleteArg.where.gallery_record_id).toBe(RECORD_ID);

    const calls = rawCalls(executeRaw);
    expect(calls).toHaveLength(2);
    const galleryDecrement = calls.find(c =>
      c.sql.includes('cached_gallery_count')
    );
    const likesDecrement = calls.find(c =>
      c.sql.includes('cached_likes_count')
    );
    // Floored (GREATEST(0, ...)) decrement by exactly 1 record for THIS owner.
    expect(galleryDecrement?.sql).toContain('GREATEST');
    expect(galleryDecrement?.by).toBe(1);
    expect(galleryDecrement?.accountId).toBe(ACCOUNT_ID);
    // Likes decrement by the PRE-delete like tally (cascade would zero it post-delete).
    expect(likesDecrement?.by).toBe(3);
    expect(likesDecrement?.accountId).toBe(ACCOUNT_ID);

    expect(cleanupCloudinaryAsset).toHaveBeenCalledTimes(1);
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('visible record, likeCount=0: gallery-count decrement only, NO likes decrement', async () => {
    const { executeRaw } = mockScenario({ likeCount: 0 });

    const result = await deleteGalleryRecord_IO(args);

    expect(result.success).toBe(true);
    const calls = rawCalls(executeRaw);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('cached_gallery_count');
  });

  it('hidden record: delete succeeds but NO decrement at all (already subtracted at hide-time)', async () => {
    const { deleteFn, executeRaw } = mockScenario({
      isHidden: true,
      likeCount: 5,
    });

    const result = await deleteGalleryRecord_IO(args);

    expect(result.success).toBe(true);
    expect(deleteFn).toHaveBeenCalledTimes(1);
    // Both counters count VISIBLE entities only — a hidden record was already
    // removed from them by moderation; decrementing again would double-subtract.
    expect(executeRaw).not.toHaveBeenCalled();
    // Asset cleanup still fires — the blob is being physically removed.
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('record not found → GALLERY_RECORD_NOT_FOUND, no delete, no cleanup', async () => {
    const { deleteFn } = mockScenario({ exists: false });

    const result = await deleteGalleryRecord_IO(args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(deleteFn).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('foreign record → SAME GALLERY_RECORD_NOT_FOUND (anti-enumeration mask), delete NEVER runs', async () => {
    const { deleteFn, executeRaw } = mockScenario({ owner: OTHER_ACCOUNT_ID });

    const result = await deleteGalleryRecord_IO(args);

    expect(result.success).toBe(false);
    if (!result.success) {
      // Masked: indistinguishable from not-found — never an OWNERSHIP/403 oracle.
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(deleteFn).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('missing gallery_record_id → VALIDATION_ERROR (no DB access)', async () => {
    mockDb({});

    const result = await deleteGalleryRecord_IO({
      ...args,
      gallery_record_id: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
  });

  it('unknown DB throw → DATABASE_ERROR, no cleanup', async () => {
    mockDb({
      galleryRecord: {
        findUnique: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
      $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
    });

    const result = await deleteGalleryRecord_IO(args);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });
});

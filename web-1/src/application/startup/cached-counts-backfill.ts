import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { Prisma } from '../../prisma/js-client';
import {
  shouldAttemptBackfill,
  updateLastBackfillAttempt,
  tryAcquireBackfillLock,
  releaseBackfillLock,
} from './cached-counts-backfill-state';

const BATCH_SIZE = 100;

export type BackfillResult = {
  processed: number;
  updated: number;
  skipped: number;
  batches: number;
};

type AccountRow = {
  account_id: string;
  cached_bookmark_count: number;
  cached_gallery_count: number;
  cached_likes_count: number;
  _count: {
    favorited_by: number;
    gallery_record: number;
  };
};

// Raw aggregate row: likes (FavoriteGalleryRecord) of VISIBLE records, grouped by owning account.
type LikesCountRow = {
  created_by_account_id: string;
  cnt: number;
};

// DECISION: the cached_likes_count recompute MUST be raw SQL, not `_count`:
// StylistAccount._count.favorited_by counts FavoriteStylist BOOKMARKS, not likes, and
// StylistAccount has no relation to FavoriteGalleryRecord (the link goes through
// GalleryRecord.created_by_account_id). It counts likes of VISIBLE records (gr.is_hidden=false),
// the same predicate as the write path (domain/favorites/operations/favorite-count.helper.ts) and
// the reads (account-dashboard / account-profile). A predicate change MUST land in both files, or
// the public total_likes drifts.
const likesCountForBatch = async (
  pageIds: string[]
): Promise<Map<string, number>> => {
  if (pageIds.length === 0) {
    return new Map();
  }
  const rows = await DB_CLIENT.use.$queryRaw<LikesCountRow[]>(Prisma.sql`
    SELECT gr."created_by_account_id" AS created_by_account_id, COUNT(*)::int AS cnt
      FROM "FavoriteGalleryRecord" f
      JOIN "GalleryRecord" gr ON gr."gallery_record_id" = f."gallery_record_id"
     WHERE gr."created_by_account_id" IN (${Prisma.join(pageIds)})
       AND gr."is_hidden" = false
     GROUP BY gr."created_by_account_id"
  `);
  return new Map(rows.map(row => [row.created_by_account_id, row.cnt]));
};

/**
 * Pure operation: cursor-paginated backfill of cached_bookmark_count +
 * cached_gallery_count + cached_likes_count on StylistAccount. SELECT-then-UPDATE, writes
 * only when the computed value differs, so a re-run on synced data issues no UPDATE (no test
 * pins this). Safe to call directly from a CLI script.
 *
 * Does not manage the throttle or the advisory lock; runCachedCountsBackfill() does.
 */
export const backfillCachedCounts_IO = async (
  onBatch?: (batchIndex: number, processed: number, updated: number) => void
): Promise<BackfillResult> => {
  let cursor: string | undefined = undefined;
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let batches = 0;

  while (true) {
    batches++;

    const accounts = (await DB_CLIENT.use.stylistAccount.findMany({
      take: BATCH_SIZE,
      ...(cursor !== undefined
        ? { skip: 1, cursor: { account_id: cursor } }
        : {}),
      orderBy: { account_id: 'asc' },
      select: {
        account_id: true,
        cached_bookmark_count: true,
        cached_gallery_count: true,
        cached_likes_count: true,
        _count: {
          // DECISION: count only VISIBLE records (is_hidden=false), consistent with the write-path
          // inc/dec (create increment, HIDE/DELETE/BAN decrement). Without the filter the backfill
          // overwrote cached_gallery_count with the ALL-count and drifted the public photo_count.
          // Co-owner of this invariant: domain/gallery/operations/gallery-count.helper.ts. The
          // definition is split across two layers on purpose (the recompute path must read raw
          // tables); a change MUST land in both files.
          select: {
            favorited_by: true,
            gallery_record: { where: { is_hidden: false } },
          },
        },
      },
    })) as AccountRow[];

    if (accounts.length === 0) {
      break;
    }

    cursor = accounts[accounts.length - 1]?.account_id;
    processed += accounts.length;

    // Likes cannot be counted via _count (no StylistAccount->FavoriteGalleryRecord relation), so
    // one RAW JOIN per batch. An account missing from the map has 0 likes (no visible liked records).
    const likesByAccount = await likesCountForBatch(
      accounts.map(account => account.account_id)
    );
    const computedLikes = (accountId: string): number =>
      likesByAccount.get(accountId) ?? 0;

    const toUpdate = accounts.filter(
      account =>
        account.cached_bookmark_count !== account._count.favorited_by ||
        account.cached_gallery_count !== account._count.gallery_record ||
        account.cached_likes_count !== computedLikes(account.account_id)
    );

    if (toUpdate.length > 0) {
      // DECISION: Promise.all instead of $transaction(array). A Prisma $transaction(array) is a
      // SEQUENTIAL interactive tx: 100 individual UPDATEs took ~5-15s per batch on Neon. The
      // advisory lock (`tryAcquireBackfillLock`) already serializes runs across instances and each
      // UPDATE targets a distinct account_id, so parallelism is safe (~200-800ms per batch). One
      // rejection is caught by the outer try/catch in runCachedCountsBackfill and leaves a partial
      // batch applied, acceptable because a re-run recomputes only the differing rows and the next
      // cold start re-syncs the rest.
      await Promise.all(
        toUpdate.map(account =>
          DB_CLIENT.use.stylistAccount.update({
            where: { account_id: account.account_id },
            data: {
              cached_bookmark_count: account._count.favorited_by,
              cached_gallery_count: account._count.gallery_record,
              cached_likes_count: computedLikes(account.account_id),
            },
          })
        )
      );
      updated += toUpdate.length;
    }

    skipped += accounts.length - toUpdate.length;
    onBatch?.(batches, accounts.length, toUpdate.length);
  }

  return { processed, updated, skipped, batches };
};

/**
 * Auto-runner, safe to call from instrumentation.ts.
 * Throttle 24h per instance + DB advisory lock (cross-instance dedup).
 * Never throws: a backfill failure does NOT block boot.
 *
 * DECISION: the backfill runs on every cold start (resets the in-memory throttle) and the
 * advisory lock dedups the cluster. A re-run on synced data costs one SELECT
 * batch (~50ms) and no UPDATE, and gives self-healing for drift (dropped inc/dec, manual SQL,
 * races) without an operator remembering a manual run after deploy.
 */
export const runCachedCountsBackfill = async (): Promise<void> => {
  if (!shouldAttemptBackfill()) {
    return;
  }

  updateLastBackfillAttempt();

  const acquired = await tryAcquireBackfillLock();
  if (!acquired) {
    return;
  }

  try {
    const result = await backfillCachedCounts_IO();

    if (result.updated > 0) {
      reportIssueBackend({
        namespace: 'cachedCountsBackfill',
        message: `Backfilled ${result.updated} StylistAccount cached counts (${result.batches} batches, ${result.skipped} in sync)`,
        payload: result,
        mode: 'warn',
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'cachedCountsBackfill',
      message: 'Backfill failed',
      payload: error,
      mode: 'error',
    });
  } finally {
    await releaseBackfillLock();
  }
};

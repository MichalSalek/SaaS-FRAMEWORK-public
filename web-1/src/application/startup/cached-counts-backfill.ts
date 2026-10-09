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

// DECISION (nie usuwaj tego komentarza) — cached_likes_count recompute MUSI iść RAW SQL, nie
// _count: relacja StylistAccount._count.favorited_by to FavoriteStylist BOOKMARKS, a NIE lajki;
// StylistAccount nie ma w ogóle relacji do FavoriteGalleryRecord (link jest pośredni przez
// GalleryRecord.created_by_account_id). Liczymy lajki WIDOCZNYCH rekordów (gr.is_hidden=false) —
// ten SAM predykat co write-path (favorites/operations/favorite-count.helper.ts inc/dec) i co
// reads (account-dashboard / account-profile). Współwłaściciel tego invariantu to favorite-count.helper.ts
// (DECISION:22-31) — zmiana predykatu MUSI iść równolegle w obu plikach, inaczej publiczny total_likes
// zdryfuje (analogicznie do RC-011 dla cached_gallery_count).
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
 * cached_gallery_count + cached_likes_count na StylistAccount. Idempotent —
 * SELECT-then-UPDATE, only writes when delta differs. Safe to call directly z CLI script.
 *
 * Nie zarządza throttle ani advisory lock — to robi runCachedCountsBackfill().
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
          // DECISION (nie usuwaj tego komentarza) — RC-011, parytet recompute↔write-path:
          // Licz tylko VISIBLE rekordy (is_hidden=false) — spójnie z inc/dec write-path
          // (createGalleryRecord increment + HIDE/DELETE/BAN decrement liczą widoczne). Bez filtra
          // backfill nadpisywał cached_gallery_count count-em ALL, driftując publiczny photo_count.
          // Współwłaściciel tego invariantu: domain/gallery/operations/gallery-count.helper.ts
          // (write-path inc/dec + DECISION:39-50). Definicja „co się liczy" jest rozproszona na 2
          // warstwy CELOWO (recompute-path musi czytać surowe tabele) — zmiana MUSI iść równolegle
          // w obu plikach, inaczej publiczny photo_count zdryfuje (RC-011 raz tak zdryfował).
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

    // Likes nie da się policzyć przez _count (brak relacji StylistAccount->FavoriteGalleryRecord) —
    // jeden RAW JOIN per batch. Brak konta w mapie = 0 lajków (account bez widocznych polubionych rekordów).
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
      // DECISION (nie usuwaj tego komentarza):
      // H8 (run 28) — Promise.all (parallel) instead of $transaction(...).
      // The previous Prisma $transaction(array) is a SEQUENTIAL interactive tx —
      // 100 individual UPDATEs hit ~5-15s per batch on Neon. The advisory lock
      // (`tryAcquireBackfillLock`) already serializes runs cross-instance and
      // each UPDATE targets a distinct account_id (no row conflicts within a
      // batch). Parallelism is therefore SAFE and slashes batch latency to
      // ~200-800ms. Failure mode: one Promise rejection rolls up — caught by
      // outer try/catch in runCachedCountsBackfill, partial batch is left
      // applied (acceptable: backfill is idempotent SELECT-then-UPDATE; next
      // cold-start re-syncs remaining accounts).
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
 * Auto-runner: bezpieczny do wywołania z instrumentation.ts.
 * Throttle 24h per instance + DB advisory lock (cross-instance dedup).
 * Nigdy nie rzuca — backfill failure NIE blokuje boot.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Backfill leci na każdym cold start (resetuje in-memory throttle), advisory
 * lock dedup'uje cluster. Idempotent (SELECT-then-UPDATE), więc re-run gdy
 * synced = 1 SELECT batch (~50ms) + zero UPDATE. Cost minimalny, zysk:
 * self-healing dla drift (dropped inc/dec call, manual SQL, race). Operator
 * NIE musi pamiętać o uruchomieniu manualnym po deploy.
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

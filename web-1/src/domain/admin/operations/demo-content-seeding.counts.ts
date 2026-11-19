import { DB_CLIENT } from '@app/db/db.client';

/** Przeliczenie denormalizowanych liczników kont stylistek wystawy demo. */
export const recomputeDemoCachedCounts_IO = async (
  accountIds: readonly string[]
): Promise<void> => {
  // The demo seed writes likes directly, bypassing the write-path helper (favorite-count.helper.ts
  // needs an active tx), so the counters are recomputed here for a consistent first dashboard render.
  for (const accountId of new Set(accountIds)) {
    const [galleryCount, bookmarkCount, likesCount] = await Promise.all([
      // Widoczne rekordy: parytet z write-path i backfillem (DECISION
      // stylistaccount-cached-gallery-count, RC-011).
      DB_CLIENT.use.galleryRecord.count({
        where: { created_by_account_id: accountId, is_hidden: false },
      }),
      DB_CLIENT.use.favoriteStylist.count({
        where: { stylist_account_id: accountId },
      }),
      DB_CLIENT.use.favoriteGalleryRecord.count({
        where: {
          record: { created_by_account_id: accountId, is_hidden: false },
        },
      }),
    ]);
    await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: accountId },
      data: {
        cached_gallery_count: galleryCount,
        cached_bookmark_count: bookmarkCount,
        cached_likes_count: likesCount,
      },
    });
  }
};

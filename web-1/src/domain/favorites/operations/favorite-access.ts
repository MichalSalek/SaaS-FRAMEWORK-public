import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { DB_CLIENT } from '@app/db/db.client';
import { resolveAccessibleAuthorIds_IO } from '@domain/pairing/author-access';
import type { IDType } from '@kernel/application/application.types';
import type { Prisma } from '../../../prisma/js-client';

/**
 * Read boundary of a client's liked records (FavoriteGalleryRecord -> asset_url).
 *
 * DECISION: a liked record is returned only while the client can CURRENTLY see it: pinned (public discovery
 * channel) or unpinned with current access to its author, where "access" is exactly resolveSalonAccess_IO (an
 * active direct pair, or live salon access: owner on a paid Studio/Scale plan, accepted active membership with
 * public_profile_visible, and no explicit disconnect by that stylist). Row existence is NOT authorization: a row
 * can outlive its access (a like committed in the add-vs-revoke race before the lock fix, a salon member leaving,
 * the owner losing the plan, a contribution switch turned off), so every read filters, and the filter runs in SQL
 * before pagination. Do not replace the resolver with "pair status = ACTIVE": that cuts legitimate salon access.
 */
export type FavoriteReadScope = { accessibleStylistIds: string[] };

/**
 * Authors whose UNPINNED liked records this client may read now. Bounded by the distinct authors of her own
 * unpinned likes (never all photos); the per-author decision is resolveAccessibleAuthorIds_IO.
 */
export const resolveFavoriteReadScope_IO = async (
  clientUserId: IDType,
  db: Prisma.TransactionClient = DB_CLIENT.use
): Promise<FavoriteReadScope> => {
  const authors = await db.stylistAccount.findMany({
    where: {
      ...STYLIST_PUBLICLY_VISIBLE,
      gallery_record: {
        some: {
          is_pinned: false,
          is_hidden: false,
          favorited_by: { some: { client_user_id: clientUserId } },
        },
      },
    },
    select: { account_id: true },
  });
  return {
    accessibleStylistIds: await resolveAccessibleAuthorIds_IO(
      clientUserId,
      authors.map(author => author.account_id),
      db
    ),
  };
};

/** The `record` where-fragment of every liked-records read: visible, and pinned or accessible now. */
export const favoriteReadableRecordWhere = (
  scope: FavoriteReadScope
): Prisma.GalleryRecordWhereInput => ({
  is_hidden: false,
  // Visibility-cascade parity: disable/ban/soft-delete do not set is_hidden. SSOT: STYLIST_PUBLICLY_VISIBLE.
  created_by_account: STYLIST_PUBLICLY_VISIBLE,
  OR: [
    { is_pinned: true },
    { created_by_account_id: { in: scope.accessibleStylistIds } },
  ],
});

export const resolveReadableFavoriteIds_IO = async (
  clientUserId: IDType,
  favoriteIds: readonly string[],
  db: Prisma.TransactionClient = DB_CLIENT.use
): Promise<Set<string>> => {
  if (favoriteIds.length === 0) {
    return new Set();
  }
  const scope = await resolveFavoriteReadScope_IO(clientUserId, db);
  const readable = await db.favoriteGalleryRecord.findMany({
    where: {
      id: { in: [...favoriteIds] },
      client_user_id: clientUserId,
      record: favoriteReadableRecordWhere(scope),
    },
    select: { id: true },
  });
  return new Set(readable.map(row => row.id));
};

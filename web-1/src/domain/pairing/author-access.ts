import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import type { IDType } from '@kernel/application/application.types';
import type { Prisma } from '../../prisma/js-client';
import { resolveSalonAccess_IO } from './salon-access.resolver';

/**
 * Which of these authors may this client see PRIVATE (unpinned) works of right now?
 *
 * DECISION: the answer is resolveSalonAccess_IO per author, never a shortcut through another author: access to a
 * salon owner does not imply access to every member (a member's explicit disconnect, REVOKED by STYLIST, wins),
 * and a pair's status alone misses salon access. Direct pairs are batched in one query that mirrors the
 * resolver's direct branch; only the remaining authors go through the resolver's salon branch, and not at all
 * when the client has no direct pair (salon access needs a direct seed). The salon branch stays per author on
 * purpose: batching it would mean a second copy of the salon predicate (plan, membership, seeds, disconnect)
 * that can drift from the resolver; the inputs are bounded (one client's liked authors, one salon's team).
 */
export const resolveAccessibleAuthorIds_IO = async (
  clientUserId: IDType,
  authorIds: readonly string[],
  db: Prisma.TransactionClient = DB_CLIENT.use
): Promise<string[]> => {
  if (authorIds.length === 0) {
    return [];
  }
  const directPairs = await db.clientStylistPair.findMany({
    where: {
      client_user_id: clientUserId,
      status: 'ACTIVE',
      salon_origin_account_id: null,
      stylist_account: STYLIST_PUBLICLY_VISIBLE,
      client_user: { is_active: true },
    },
    select: { stylist_account_id: true },
  });
  const direct = new Set(directPairs.map(pair => pair.stylist_account_id));
  const accessible = authorIds.filter(authorId => direct.has(authorId));
  if (direct.size === 0) {
    return accessible;
  }
  const salonChecked = await Promise.all(
    authorIds
      .filter(authorId => !direct.has(authorId))
      .map(async authorId =>
        (await resolveSalonAccess_IO(clientUserId, authorId, db, true))
          ? authorId
          : null
      )
  );
  return [
    ...accessible,
    ...salonChecked.filter((id): id is string => id !== null),
  ];
};

import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { lockStylistAccount } from '@app/db/lock-rows';
import {
  PINNED_GALLERY_RECORD_ORDER_BY,
  VISIBLE_PINNED_GALLERY_RECORD_WHERE,
} from '@domain/gallery/gallery-record-visibility';
import type { GalleryPinnedOrderStaleError } from '@kernel/domain/gallery/gallery-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

type PinnedRecordsResponse =
  GALLERY_DTO_API_V1['GALLERY_GET_PINNED_RECORDS']['RESPONSE'];

/**
 * The owner's visible pinned works in public-profile order (pin manager).
 * Visible = the same set the public profile and the pin quota use, so the list she
 * reorders is exactly the list a stranger sees. Bounded by the pin gate (plan limit).
 */
export const getPinnedGalleryRecords_IO = async ({
  stylist_account_id,
}: {
  stylist_account_id: string;
}): Promise<OperationResult<PinnedRecordsResponse, DatabaseError>> => {
  try {
    const records = await DB_CLIENT.use.galleryRecord.findMany({
      where: {
        created_by_account_id: stylist_account_id,
        ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
      },
      select: { gallery_record_id: true, asset_url: true },
      orderBy: PINNED_GALLERY_RECORD_ORDER_BY,
    });
    return success({ records });
  } catch (error) {
    return databaseFailure('getPinnedGalleryRecords', error);
  }
};

/**
 * Same set, same members: the request is a permutation of the current visible
 * pinned ids. Anything else (unknown, foreign, unpinned, hidden or missing id) means
 * the screen is stale; a partial order would leave the untouched works in an
 * undefined place, so the whole request is refused.
 */
export const isPermutationOfPinnedSet = (
  requested: readonly string[],
  current: readonly string[]
): boolean => {
  if (requested.length !== current.length) {
    return false;
  }
  const currentSet = new Set(current);
  const seen = new Set<string>();
  for (const id of requested) {
    if (!currentSet.has(id) || seen.has(id)) {
      return false;
    }
    seen.add(id);
  }
  return true;
};

/**
 * Set the order of the stylist's pinned works on her public profile.
 *
 * DECISION: the client sends the FULL order, not "move X by one", so the write sets absolute positions
 * and the last processed request IS the state; the frontend queues its requests (mutation scope) so an
 * earlier one cannot overtake a later one. lockStylistAccount comes FIRST, the same as pin/unpin, so the
 * pinned set cannot change between read and write and the set comparison is authoritative. The write is
 * ONE `UPDATE ... FROM (VALUES ...)` built entirely with Prisma.sql and passed as an ARGUMENT
 * (nf/prisma-nested-sql); `created_by_account_id` in the WHERE keeps the write on own records even
 * beyond the comparison above.
 */
export const reorderPinnedGalleryRecords_IO = async ({
  stylist_account_id,
  gallery_record_ids,
}: {
  stylist_account_id: string;
  gallery_record_ids: readonly string[];
}): Promise<
  OperationResult<
    { galleryRecordIds: string[] },
    GalleryPinnedOrderStaleError | DatabaseError
  >
> => {
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, stylist_account_id);

      const pinned = await tx.galleryRecord.findMany({
        where: {
          created_by_account_id: stylist_account_id,
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
        select: { gallery_record_id: true },
      });
      const currentIds = pinned.map(row => row.gallery_record_id);

      if (!isPermutationOfPinnedSet(gallery_record_ids, currentIds)) {
        return failure({
          type: 'GALLERY_PINNED_ORDER_STALE',
          expectedCount: currentIds.length,
          receivedCount: gallery_record_ids.length,
        });
      }

      const values = Prisma.join(
        gallery_record_ids.map(
          (id, position) => Prisma.sql`(${id}, ${position}::integer)`
        )
      );
      const query = Prisma.sql`
        UPDATE "GalleryRecord" AS g
        SET "pinned_position" = v.position
        FROM (VALUES ${values}) AS v(id, position)
        WHERE g."gallery_record_id" = v.id
          AND g."created_by_account_id" = ${stylist_account_id}
          AND g."is_pinned" = true
      `;
      await tx.$executeRaw(query);

      return success({ galleryRecordIds: [...gallery_record_ids] });
    });
  } catch (error) {
    return databaseFailure('reorderPinnedGalleryRecords', error);
  }
};

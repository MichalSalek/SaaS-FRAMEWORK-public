import { DB_CLIENT } from '@app/db/db.client';
import type { IDType } from '@kernel/application/application.types';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { GalleryContracts } from '@kernel/domain/gallery/gallery.contracts';

type GalleryHandlerData<K extends keyof GalleryContracts> =
  ContractHandlerResponse<GalleryContracts[K]>;
import {
  assertType,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import { isGalleryRecordVisibleToViewer } from '@domain/gallery/gallery-record-visibility';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * Get a single gallery record by ID with metadata
 *
 * is_pinned logic:
 *   - If current user is the stylist owner: returns the record's own is_pinned flag
 *   - If current user is a client: returns whether the record is in their favorites
 *   - For all other cases: false
 */
export const getGalleryRecordByID_IO = async ({
  gallery_record_id,
  id,
}: {
  gallery_record_id: IDType;
  /** id = currentUser.id (user ID from session) */
  id: IDType;
}): Promise<
  OperationResult<
    GalleryHandlerData<'GET_GALLERY_RECORD_BY_ID'>,
    GalleryRecordNotFoundError | DatabaseError
  >
> => {
  try {
    const galleryRecord = await DB_CLIENT.use.galleryRecord.findUnique({
      where: {
        gallery_record_id,
      },
      include: {
        // Scoped select for mapGalleryColors/Traits: only the columns they read,
        // not the full color or trait row.
        ...GALLERY_COLORS_TRAITS_SELECT,
        created_by_account: {
          select: {
            account_id: true,
            display_name: true,
            business_name: true,
            address_city: true,
            // created_by_user_id is selected ONLY for the server-side ownership check (isOwner below) and is
            // never returned; the payload exposes only the public stylist_info subset.
            created_by_user_id: true,
            // account_status + created_by_user.is_active are selected only for the server-side visibility
            // guard (isGalleryRecordVisibleToViewer below) and are never returned to the client.
            account_status: true,
            created_by_user: {
              select: {
                is_active: true,
              },
            },
          },
        },
        favorited_by: {
          where: {
            client_user_id: id,
          },
          select: {
            id: true,
          },
          take: 1,
        },
      },
    });

    if (!galleryRecord) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    const isFavorited = galleryRecord.favorited_by.length > 0;

    // is_pinned:
    //   - Owner (stylist): use the record's own is_pinned field
    //   - Client (or any other user): use is_favorited (already computed above)
    const isOwner = galleryRecord.created_by_account.created_by_user_id === id;

    // Per-record visibility gate (owner bypass / is_hidden / stylist publicly visible /
    // pinned or ACTIVE pair) — SSOT with its DECISIONs in gallery-record-visibility.ts,
    // shared with report-abuse so no endpoint acts on a record this viewer cannot see.
    // A miss is the SAME NOT_FOUND as a nonexistent id (no existence oracle).
    if (!(await isGalleryRecordVisibleToViewer(galleryRecord, id))) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    const isPinned = isOwner ? galleryRecord.is_pinned : isFavorited;

    const responsePayload: GalleryHandlerData<'GET_GALLERY_RECORD_BY_ID'> = {
      gallery_record: {
        gallery_record_id: galleryRecord.gallery_record_id,
        asset_url: galleryRecord.asset_url,
        colors: mapGalleryColors(galleryRecord.colors),
        traits: mapGalleryTraits(galleryRecord.traits),
        nail_length: assertType(
          galleryRecord.nail_length,
          isNailLengthNarrower,
          'nail_length in getGalleryRecordByID_IO'
        ),
        created_at: galleryRecord.created_at,
      },
      stylist_info: {
        account_id: galleryRecord.created_by_account.account_id,
        display_name: galleryRecord.created_by_account.display_name,
        business_name: galleryRecord.created_by_account.business_name,
        address_city: galleryRecord.created_by_account.address_city,
      },
      is_favorited: isFavorited,
      is_pinned: isPinned,
    };

    return success(responsePayload);
  } catch (error) {
    return databaseFailure('getGalleryRecordByID_IO', error);
  }
};

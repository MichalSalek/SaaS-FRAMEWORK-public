import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { GalleryRecord } from '@kernel/models/db_models.generated.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import { isP2025 } from '@app/db/prisma-error';
import { lockGalleryRecord } from '@app/db/lock-rows';
import {
  assertType,
  hasCode,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  ValidationError,
  DatabaseError,
} from '@kernel/application/common-errors.types';

/**
 * Update an existing gallery record — replaces color/trait junctions
 */
export const updateGalleryRecord_IO = async ({
  props,
  id,
}: {
  props: {
    created_by_account_id: IDType;
    gallery_record_id: GalleryRecord['gallery_record_id'];
    color_ids?: string[];
    trait_ids?: string[];
    nail_length?: NailLength;
  };
  id: IDType;
}): Promise<
  OperationResult<
    {
      gallery_record_id: string;
      nail_length: NailLength;
      colors: Array<{ id: string; name: string; hex_code: string }>;
      traits: Array<{
        id: string;
        name: string;
        category: TraitCategory;
        icon_url: string | null;
        is_featured: boolean;
      }>;
    },
    // DECISION: no GalleryRecordOwnershipError in the union: a foreign record is masked as
    // GALLERY_RECORD_NOT_FOUND (see the ownership branch below); the op never returns OWNERSHIP_ERROR.
    GalleryRecordNotFoundError | ValidationError | DatabaseError
  >
> => {
  const {
    created_by_account_id,
    gallery_record_id,
    color_ids: rawColorIds,
    trait_ids: rawTraitIds,
    nail_length,
  } = props;

  if (!created_by_account_id) {
    reportIssueBackend({
      namespace: 'updateGalleryRecord_IO',
      message: `accountID ${created_by_account_id}`,
      payload: props,
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'created_by_account_id',
      message: 'Missing account ID',
    });
  }

  // DECISION: curation gate, same as gallery-create.operation.ts: color_id/trait_id must reference ACTIVE
  // dictionary entries. `is_active=false` retires an entry (it leaves the GET_COLORS/GET_TRAITS pickers), but
  // the junction createMany only enforces FK existence (P2003), so a stylist holding a retired id could attach
  // it on edit (create blocked it, update did not: parity gap). One index-backed findMany per dictionary
  // (id IN ..., is_active:true) over the deduped set; a count mismatch (missing or retired id) is a
  // VALIDATION_ERROR (4xx) BEFORE the tx, with the same typed error and messages as create. Only dictionaries
  // actually supplied in this partial update are validated (rawColorIds/rawTraitIds !== undefined; an empty
  // array is rejected earlier by the validator). Outside the tx (reference-data read). Accepted residual
  // TOCTOU: an entry retired between check and createMany still lands, as on create; the P2003 catch below
  // covers an id DELETED in that window.
  // Test: web-1/src/domain/gallery/operations/gallery-update.operation.test.ts (covers the P2003 mapping
  // with a mocked throw; not a live race).
  try {
    if (rawColorIds !== undefined) {
      const color_ids = [...new Set(rawColorIds)];
      if (color_ids.length > 0) {
        const activeColors = await DB_CLIENT.use.color.findMany({
          where: { id: { in: color_ids }, is_active: true },
          select: { id: true },
        });
        if (activeColors.length !== color_ids.length) {
          reportIssueBackend({
            namespace: 'updateGalleryRecord_IO',
            message: `Rejected update: one or more color_ids are inactive/non-existent for account ${created_by_account_id}`,
            payload: { created_by_account_id, gallery_record_id, color_ids },
            mode: 'info',
          });
          return failure({
            type: 'VALIDATION_ERROR',
            field: 'color_ids',
            message: 'One or more colors are unavailable',
          });
        }
      }
    }

    if (rawTraitIds !== undefined) {
      const trait_ids = [...new Set(rawTraitIds)];
      if (trait_ids.length > 0) {
        const activeTraits = await DB_CLIENT.use.trait.findMany({
          where: { id: { in: trait_ids }, is_active: true },
          select: { id: true },
        });
        if (activeTraits.length !== trait_ids.length) {
          reportIssueBackend({
            namespace: 'updateGalleryRecord_IO',
            message: `Rejected update: one or more trait_ids are inactive/non-existent for account ${created_by_account_id}`,
            payload: { created_by_account_id, gallery_record_id, trait_ids },
            mode: 'info',
          });
          return failure({
            type: 'VALIDATION_ERROR',
            field: 'trait_ids',
            message: 'One or more style traits are unavailable',
          });
        }
      }
    }
  } catch (error) {
    return databaseFailure(
      'updateGalleryRecord_IO:reference-validation',
      error
    );
  }

  // Partial update: ownership check + mutations inside a single transaction
  let result;
  try {
    result = await DB_CLIENT.use.$transaction(async tx => {
      // Check existence and ownership inside transaction. The read TAKES a row lock so
      // concurrent edits of the same record serialize: the junction replace below is
      // delete-then-create, and two interleaved replaces collided on the link tables'
      // unique pair (P2002 → 500). Rationale: see lockGalleryRecord.
      const existing = await lockGalleryRecord(tx, gallery_record_id);

      if (!existing) {
        return { error: 'NOT_FOUND' as const };
      }

      if (existing.created_by_account_id !== created_by_account_id) {
        return {
          error: 'OWNERSHIP' as const,
          ownerId: existing.created_by_account_id,
        };
      }

      // Replace color junctions only if color_ids provided
      if (rawColorIds !== undefined) {
        const color_ids = [...new Set(rawColorIds)];
        await tx.galleryRecordColor.deleteMany({
          where: { gallery_record_id },
        });
        if (color_ids.length > 0) {
          await tx.galleryRecordColor.createMany({
            data: color_ids.map(color_id => ({ gallery_record_id, color_id })),
          });
        }
      }

      // Replace trait junctions only if trait_ids provided
      if (rawTraitIds !== undefined) {
        const trait_ids = [...new Set(rawTraitIds)];
        await tx.galleryRecordTrait.deleteMany({
          where: { gallery_record_id },
        });
        if (trait_ids.length > 0) {
          await tx.galleryRecordTrait.createMany({
            data: trait_ids.map(trait_id => ({ gallery_record_id, trait_id })),
          });
        }
      }

      // Update record fields (only nail_length if provided)
      // DD3-F2: include → select for colors/traits (drop junction columns we don't need)
      const updated = await tx.galleryRecord.update({
        data: {
          ...(nail_length !== undefined && { nail_length }),
        },
        where: {
          gallery_record_id,
          created_by_account_id,
        },
        select: {
          gallery_record_id: true,
          nail_length: true,
          ...GALLERY_COLORS_TRAITS_SELECT,
        },
      });

      return { error: null as null, updated };
    });
  } catch (error) {
    // DECISION: P2003 on the junction deleteMany+createMany replace means a well-formed but non-existent
    // color_id/trait_id from a stale client dictionary: bad INPUT, not a DB outage. It maps to
    // VALIDATION_ERROR (4xx) and logs as mode:'info' instead of databaseFailure (mode:'error' plus stack would
    // pollute the anomaly channel as if Postgres were down). Mirrors the create-side branch. Throwing inside
    // $transaction rolls back the whole replace, so colors, traits and nail_length stay unchanged.
    if (hasCode(error) && error.code === 'P2003') {
      reportIssueBackend({
        namespace: 'updateGalleryRecord_IO',
        message: `Invalid color_id/trait_id (FK P2003) for account ${created_by_account_id}`,
        payload: { created_by_account_id, gallery_record_id },
        mode: 'info',
      });
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'color_ids/trait_ids',
        message: 'One or more color or trait IDs do not exist',
      });
    }

    // DECISION: P2025 (record not found on a required write): the in-TX findUnique confirmed the record, but a
    // concurrent DELETE (second tab or moderation resolve-report) can remove it before the final singular
    // `update` under READ COMMITTED. The nail_length-only path has no junction createMany, so no P2003 would
    // intercept it and it would fall to databaseFailure (HTTP 500 plus a false Postgres-down alarm). It maps to
    // GALLERY_RECORD_NOT_FOUND, as in unpinGalleryRecord_IO and gallery-delete (vanished mid-flight is
    // not-found). The structural detector isP2025 is used, not instanceof (Turbopack-safe).
    if (isP2025(error)) {
      return failure({
        type: 'GALLERY_RECORD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    return databaseFailure('updateGalleryRecord', error);
  }

  // DECISION: anti-enumeration mask. A record that exists but belongs to another stylist returns exactly the
  // same GALLERY_RECORD_NOT_FOUND (404) as a missing one instead of OWNERSHIP_ERROR (403), because 403 vs 404
  // exposed which IDs exist. The attempt is logged server-side (mode:'error', with ownerId) for forensics and
  // never reaches the response. The 'OWNERSHIP' marker in the tx stays (it carries ownerId to the log); the
  // 404 mapping happens here at the response boundary. Same as gallery-delete and gallery-pin; ownership
  // stays after RBAC.
  if (result.error === 'OWNERSHIP') {
    reportIssueBackend({
      namespace: 'updateGalleryRecord_IO',
      message: `Unauthorized update attempt (masked as 404). Owner: ${result.ownerId}, Requester: ${created_by_account_id}`,
      payload: { gallery_record_id, id },
      mode: 'error',
    });
  }

  if (result.error === 'NOT_FOUND' || result.error === 'OWNERSHIP') {
    return failure({
      type: 'GALLERY_RECORD_NOT_FOUND',
      recordId: gallery_record_id,
    });
  }

  const { updated } = result;

  reportIssueBackend({
    namespace: 'updateGalleryRecord_IO',
    message: `Gallery record updated successfully: ${gallery_record_id}`,
    payload: { gallery_record_id, id },
    mode: 'info',
  });

  return success({
    gallery_record_id: updated.gallery_record_id,
    nail_length: assertType(
      updated.nail_length,
      isNailLengthNarrower,
      'nail_length in updateGalleryRecord_IO'
    ),
    colors: mapGalleryColors(updated.colors),
    traits: mapGalleryTraits(updated.traits),
  });
};

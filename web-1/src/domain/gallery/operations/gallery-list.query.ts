import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { IDType } from '@kernel/application/application.types';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { GalleryContracts } from '@kernel/domain/gallery/gallery.contracts';

type GalleryHandlerData<K extends keyof GalleryContracts> =
  ContractHandlerResponse<GalleryContracts[K]>;
import type { Prisma } from '../../../prisma/js-client';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  ValidationError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import {
  assertType,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';

/**
 * Get gallery records with optional filtering via junction tables.
 * Cursor-paginated (default 50, max 100). Cursor by gallery_record_id.
 */
export const getGalleryRecords_IO = async ({
  props,
}: {
  props: {
    created_by_account_id: IDType;
    gallery_record_id?: IDType | undefined;
    color_ids: IDType[];
    trait_ids: IDType[];
    apply_strict_filter: boolean;
    nail_length?: NailLength;
    cursor?: string | undefined;
    take?: number | undefined;
  };
}): Promise<
  OperationResult<
    GalleryHandlerData<'GET_GALLERY_RECORDS'>,
    ValidationError | DatabaseError
  >
> => {
  const {
    created_by_account_id,
    gallery_record_id,
    color_ids = [],
    trait_ids = [],
    apply_strict_filter,
    nail_length,
    cursor,
    take = 50,
  } = props;

  if (!created_by_account_id) {
    reportIssueBackend({
      namespace: 'getGalleryRecords_IO',
      message: `no accountID.`,
      payload: created_by_account_id,
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'created_by_account_id',
      message: 'Missing account ID',
    });
  }

  const effectiveTake = Math.min(Math.max(take, 1), 100);

  const where: Prisma.GalleryRecordWhereInput = {
    ...(gallery_record_id !== undefined && { gallery_record_id }),
    created_by_account_id,
    ...(nail_length && { nail_length }),
  };

  // Filter by colors via junction table
  if (color_ids.length > 0) {
    if (apply_strict_filter) {
      // Must have ALL specified colors
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...color_ids.map(cid => ({
          colors: { some: { color_id: cid } },
        })),
      ];
    } else {
      // Must have at least ONE specified color
      where.colors = { some: { color_id: { in: color_ids } } };
    }
  }

  // Filter by traits via junction table
  if (trait_ids.length > 0) {
    if (apply_strict_filter) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...trait_ids.map(tid => ({
          traits: { some: { trait_id: tid } },
        })),
      ];
    } else {
      where.traits = { some: { trait_id: { in: trait_ids } } };
    }
  }

  // DECISION: this list is owner-scoped (account_id from the session). Reject a bad
  // cursor format before Prisma, and pre-check existence with the same
  // created_by_account_id: findMany returns [] for a stale cursor, and an unscoped
  // findUnique answered 200 for another stylist's live or hidden record.
  // Dropping the scope reopens that oracle. Do not copy the scope onto public feeds
  // (no oracle there; unscoped findUnique survives mid-scroll). Filters stay outside
  // the check; the P2025 catch remains a fallback.
  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.galleryRecord.findFirst({
        where: { gallery_record_id: cursor, created_by_account_id },
        select: { gallery_record_id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getGalleryRecords_IO:cursorCheck', error);
    }
  }

  try {
    const records = await DB_CLIENT.use.galleryRecord.findMany({
      where,
      include: { ...GALLERY_COLORS_TRAITS_SELECT },
      orderBy: [{ created_at: 'desc' }, { gallery_record_id: 'desc' }],
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { gallery_record_id: cursor }, skip: 1 } : {}),
    });

    const hasMore = records.length > effectiveTake;
    const pageItems = hasMore ? records.slice(0, effectiveTake) : records;

    const mapped: GalleryHandlerData<'GET_GALLERY_RECORDS'>['records'] =
      pageItems.map(r => ({
        gallery_record_id: r.gallery_record_id,
        asset_url: r.asset_url,
        nail_length: assertType(
          r.nail_length,
          isNailLengthNarrower,
          'nail_length in getGalleryRecords_IO'
        ),
        is_pinned: r.is_pinned,
        colors: mapGalleryColors(r.colors),
        traits: mapGalleryTraits(r.traits),
        created_at: r.created_at,
      }));

    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.gallery_record_id ?? null)
        : null;

    return success({ records: mapped, nextCursor });
  } catch (error: unknown) {
    // DECISION: P2025 on the cursor query means the client sent a non-existent or stale cursor, which is
    // input validation (400), not a DB outage (503); otherwise every stale cursor would look like a
    // Postgres outage in the event log.
    if (isP2025(error)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    return databaseFailure('getGalleryRecords_IO', error);
  }
};

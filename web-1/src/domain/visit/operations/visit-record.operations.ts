import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ClientUnauthorizedAccessError } from '@kernel/domain/client/client-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import type { ClientCardPlanLockedError } from '@kernel/domain/visit/visit-errors.types';
import { VisitRecordSourceValue } from '@kernel/models/db_models.generated.dto';
import type { HistoryAccessDTO } from '@kernel/models/pricing/history-access.dto';
import type {
  ExpiredSessionSummaryDTO,
  VisitRecordDTO,
} from '@kernel/models/visit/visit.dto';
import { loadExpiredSessionSummaries } from './visit-expired-sessions.query';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import { clampInt } from '@app/http/query-params.utils';
import {
  assertHistoryAccess,
  buildVisitWhere,
  getHistoryAccess,
  mapVisitToDTO,
  normalizeNullableText,
  requireActivePairing_IO,
  requireActivePairingLocked_IO,
  requireVisitAccess_IO,
  VISIT_LIST_DEFAULT_TAKE,
  VISIT_LIST_MAX_TAKE,
  VISIT_RESULT_PHOTOS_INCLUDE,
  type VisitAccessError,
} from './visit-common.operations';

export const getClientVisits_IO = async ({
  stylist_account_id,
  client_user_id,
  stylist_pricing_plan,
  cursor,
  take = VISIT_LIST_DEFAULT_TAKE,
}: {
  stylist_account_id: string;
  client_user_id: string;
  stylist_pricing_plan: PricingPlan;
  cursor?: string;
  take?: number;
}): Promise<
  OperationResult<
    {
      visits: VisitRecordDTO[];
      nextCursor: string | null;
      historyAccess: HistoryAccessDTO;
      expiredSessions: ExpiredSessionSummaryDTO[];
    },
    ClientUnauthorizedAccessError | ValidationError | DatabaseError
  >
> => {
  const pairing = await requireActivePairing_IO({
    client_user_id,
    stylist_account_id,
  });
  if (!pairing.success) {
    return pairing;
  }

  const historyAccess = getHistoryAccess(stylist_pricing_plan);
  if (!historyAccess.canViewHistory) {
    return success({
      visits: [],
      nextCursor: null,
      historyAccess,
      expiredSessions: [],
    });
  }

  // clampInt (not bare Math.min/max): the value comes from the query string and a clamp alone does not
  // floor it, so `take=2.7` reached Prisma as a fractional take. The repo has a dedicated tool for this
  // class (DECISION in query-params.utils.ts); this list is not an exception.
  const effectiveTake = clampInt(take, VISIT_LIST_MAX_TAKE, 1);
  const where = buildVisitWhere({
    client_user_id,
    stylist_account_id,
    retentionDays: historyAccess.retentionDays,
  });

  if (cursor !== undefined) {
    if (!isValidCursorFormat(cursor)) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }
    try {
      const cursorRow = await DB_CLIENT.use.visitRecord.findFirst({
        where: { ...where, id: cursor },
        select: { id: true },
      });
      if (!cursorRow) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
    } catch (error) {
      return databaseFailure('getClientVisits_IO:cursorCheck', error);
    }
  }

  try {
    const visits = await DB_CLIENT.use.visitRecord.findMany({
      where,
      include: VISIT_RESULT_PHOTOS_INCLUDE,
      orderBy: [{ visit_date: 'desc' }, { id: 'desc' }],
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = visits.length > effectiveTake;
    const pageItems = hasMore ? visits.slice(0, effectiveTake) : visits;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null;

    // The expired sessions stand below the whole list, so they come with the first page only.
    const expiredSessions =
      cursor === undefined
        ? await loadExpiredSessionSummaries({
            stylist_account_id,
            client_user_id,
            retentionDays: historyAccess.retentionDays,
          })
        : [];

    return success({
      visits: pageItems.map(mapVisitToDTO),
      nextCursor,
      historyAccess,
      expiredSessions,
    });
  } catch (error) {
    return databaseFailure('getClientVisits_IO', error);
  }
};

// DECISION: double-submit dedup. The same stylist + client + visit date + note within this window is the
// SAME click sent twice (double tap, retry after a dropped connection), so the existing visit is returned
// with the same success instead of a second row. The window is short on purpose: two REAL visits on one
// day with an identical note are possible, but not seconds apart. The check runs UNDER the pair row lock
// (requireActivePairingLocked_IO), so parallel twins serialize on it and the second sees the first's
// committed row.
export const MANUAL_VISIT_DEDUP_WINDOW_MS = 10_000;

/**
 * Per-pair visit cap reached: thrown INSIDE the transaction to roll back the insert, mapped below to
 * VALIDATION_ERROR (not a database error).
 */
class VisitLimitRollback extends Error {
  constructor() {
    super('Visit limit per pair reached');
  }
}

export const createManualVisit_IO = async ({
  stylist_account_id,
  client_user_id,
  stylist_pricing_plan,
  visit_date,
  service_note,
}: {
  stylist_account_id: string;
  client_user_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_date: string;
  service_note?: string;
}): Promise<
  OperationResult<
    VisitRecordDTO,
    | ClientUnauthorizedAccessError
    | ClientCardPlanLockedError
    | ValidationError
    | DatabaseError
  >
> => {
  const historyAccess = assertHistoryAccess(stylist_pricing_plan);
  if (!historyAccess.success) {
    return historyAccess;
  }

  const pairing = await requireActivePairing_IO({
    client_user_id,
    stylist_account_id,
  });
  if (!pairing.success) {
    return pairing;
  }

  try {
    // Revoke-race barrier: re-confirm ACTIVE pairing UNDER A ROW LOCK in the SAME tx as the
    // create, so a revoke committing after the outer requireActivePairing_IO check cannot leave a
    // manual visit attached to a just-revoked client.
    return await DB_CLIENT.use.$transaction(async tx => {
      const barrier = await requireActivePairingLocked_IO(
        tx,
        client_user_id,
        stylist_account_id
      );
      if (!barrier.success) {
        return barrier;
      }

      const visitDate = new Date(visit_date);
      const normalizedNote = normalizeNullableText(service_note);
      const duplicate = await tx.visitRecord.findFirst({
        where: {
          client_user_id,
          stylist_account_id,
          source: VisitRecordSourceValue.MANUAL,
          visit_date: visitDate,
          service_note: normalizedNote,
          created_at: {
            gte: new Date(Date.now() - MANUAL_VISIT_DEDUP_WINDOW_MS),
          },
        },
        orderBy: { created_at: 'desc' },
        include: VISIT_RESULT_PHOTOS_INCLUDE,
      });
      if (duplicate) {
        return success(mapVisitToDTO(duplicate));
      }

      // The cap is counted UNDER the same pair lock as the insert, so parallel creates are serialized
      // by it (count-then-act outside a lock could be overshot by a burst). No test pins the burst.
      const visitCount = await tx.visitRecord.count({
        where: { client_user_id, stylist_account_id },
      });
      if (visitCount >= VISIT_CONFIG.MAX_VISITS_PER_PAIR) {
        throw new VisitLimitRollback();
      }

      const visit = await tx.visitRecord.create({
        data: {
          client_user_id,
          stylist_account_id,
          visit_date: visitDate,
          service_note: normalizedNote,
          source: VisitRecordSourceValue.MANUAL,
        },
        include: VISIT_RESULT_PHOTOS_INCLUDE,
      });
      return success(mapVisitToDTO(visit));
    });
  } catch (error) {
    if (error instanceof VisitLimitRollback) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'visit_date',
        message: `Visit limit per client reached (${VISIT_CONFIG.MAX_VISITS_PER_PAIR})`,
      });
    }
    return databaseFailure('createManualVisit_IO', error);
  }
};

export const deleteManualVisit_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  visit_id,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_id: string;
}): Promise<OperationResult<{ success: true }, VisitAccessError>> => {
  const access = await requireVisitAccess_IO({
    visit_id,
    stylist_account_id,
    stylist_pricing_plan,
    // Deletion returns no content, so the retention cutoff does not apply (see the DECISION at
    // the cutoff in visit-common.operations.ts).
    purpose: 'destructive',
  });
  if (!access.success) {
    return access;
  }

  try {
    // Blobs are collected BEFORE the delete: the FK cascade removes the VisitResultPhoto rows, so after
    // the commit no URLs are left for Cloudinary cleanup (parity with account terminal-delete in
    // user-mutations.operations.ts). Cleanup is fire-and-forget AFTER a successful transaction.
    let orphanedAssetUrls: string[] = [];

    // Revoke-race barrier: re-confirm ACTIVE pairing UNDER A ROW LOCK in the SAME tx as the
    // delete (same as create/update above).
    const result: OperationResult<{ success: true }, VisitAccessError> =
      await DB_CLIENT.use.$transaction(async tx => {
        const barrier = await requireActivePairingLocked_IO(
          tx,
          access.data.client_user_id,
          stylist_account_id
        );
        if (!barrier.success) {
          return barrier;
        }

        const photos = await tx.visitResultPhoto.findMany({
          where: { visit_record_id: visit_id, stylist_account_id },
          select: { asset_url: true },
        });

        // DECISION: only source=MANUAL visits are deletable: that fixes the stylist's own mistake. source=SESSION
        // entries are an automatic record of a fact (a closed session) with no legitimate UI deletion path;
        // deleting them is a separate data policy (post-MVP, e.g. "hide"). deleteMany filtered by source
        // returns count=0 for non-manual ones => VISIT_NOT_FOUND (same anti-oracle as requireVisitAccess_IO).
        // Result photos go with the cascade (VisitResultPhoto FK ON DELETE CASCADE).
        const deleted = await tx.visitRecord.deleteMany({
          where: {
            id: visit_id,
            stylist_account_id,
            source: VisitRecordSourceValue.MANUAL,
          },
        });
        if (deleted.count === 0) {
          return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
        }
        orphanedAssetUrls = photos.map(p => p.asset_url);
        return success({ success: true as const });
      });

    if (result.success && orphanedAssetUrls.length > 0) {
      cleanupCloudinaryAssets(orphanedAssetUrls);
    }
    return result;
  } catch (error) {
    return databaseFailure('deleteManualVisit_IO', error);
  }
};

export const updateVisitServiceNote_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  visit_id,
  service_note,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  visit_id: string;
  service_note: string;
}): Promise<OperationResult<VisitRecordDTO, VisitAccessError>> => {
  const access = await requireVisitAccess_IO({
    visit_id,
    stylist_account_id,
    stylist_pricing_plan,
  });
  if (!access.success) {
    return access;
  }

  try {
    // Revoke-race barrier: re-confirm ACTIVE pairing UNDER A ROW LOCK in the SAME tx as the
    // update, so a revoke committing after the outer requireVisitAccess_IO check cannot mutate a
    // note on a just-revoked client's visit.
    return await DB_CLIENT.use.$transaction(async tx => {
      const barrier = await requireActivePairingLocked_IO(
        tx,
        access.data.client_user_id,
        stylist_account_id
      );
      if (!barrier.success) {
        return barrier;
      }

      const updateResult = await tx.visitRecord.updateMany({
        where: { id: visit_id, stylist_account_id },
        data: { service_note: normalizeNullableText(service_note) },
      });
      if (updateResult.count === 0) {
        return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
      }

      // findUnique (not ...OrThrow): update and refetch are two round trips. If the visit vanishes
      // between them (e.g. cascade from a client account deletion), null => VISIT_NOT_FOUND instead of
      // a generic DATABASE_ERROR from a thrown P2025.
      const visit = await tx.visitRecord.findUnique({
        where: { id: visit_id },
        include: VISIT_RESULT_PHOTOS_INCLUDE,
      });
      if (!visit) {
        return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
      }
      return success(mapVisitToDTO(visit));
    });
  } catch (error) {
    return databaseFailure('updateVisitServiceNote_IO', error);
  }
};

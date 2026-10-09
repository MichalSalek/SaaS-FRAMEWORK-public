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
import type { VisitRecordDTO } from '@kernel/models/visit/visit.dto';
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
    return success({ visits: [], nextCursor: null, historyAccess });
  }

  // clampInt (nie gołe Math.min/max): wartość przychodzi z query-stringu, a sama
  // klamra nie podłogowuje — `take=2.7` docierało do Prismy jako `take: 3.7`.
  // Dziś sterownik to toleruje, ale repo ma na tę klasę dedykowane narzędzie
  // z własnym DECISION (query-params.utils.ts) i nie ma powodu, żeby akurat ta
  // lista była wyjątkiem.
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

    return success({
      visits: pageItems.map(mapVisitToDTO),
      nextCursor,
      historyAccess,
    });
  } catch (error) {
    return databaseFailure('getClientVisits_IO', error);
  }
};

// DECISION (nie usuwaj tego komentarza) — 2026-09-25, dedup podwójnego wysłania:
// ta sama stylistka + ta sama klientka + ta sama data wizyty + ta sama notatka
// w ciągu tego okna = TO SAMO kliknięcie wysłane dwa razy (podwójny tap, ponowienie
// po zerwanym połączeniu), więc oddajemy istniejącą wizytę z tym samym sukcesem
// zamiast drugiego wiersza. Okno jest krótkie celowo: dwie REALNE wizyty tego samego
// dnia z identyczną notatką są możliwe, ale nie w odstępie sekund. Sprawdzenie stoi
// POD row-lockiem pary (requireActivePairingLocked_IO), więc równoległe bliźniaki
// serializują się na nim i drugi widzi zatwierdzony wiersz pierwszego.
export const MANUAL_VISIT_DEDUP_WINDOW_MS = 10_000;

/**
 * Sufit wizyt na parę osiągnięty — rzucane WEWNĄTRZ transakcji, żeby wycofać
 * insert; mapowane niżej na VALIDATION_ERROR (a nie na błąd bazy).
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

      // Cap liczony POD tym samym lockiem pary co insert, więc jest punktem
      // serializacji za darmo — równoległe tworzenie nie przeskoczy sufitu
      // (klasyczne count-then-act poza lockiem dałoby się przekroczyć burstem).
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
    // Kasowanie nie oddaje treści — cutoff retencji go nie dotyczy (DECISION przy cutoffie).
    purpose: 'destructive',
  });
  if (!access.success) {
    return access;
  }

  try {
    // Bloby zbierane PRZED kasowaniem: kaskada FK usuwa wiersze VisitResultPhoto, więc po
    // commicie nie ma już URL-i do sprzątnięcia Cloudinary (parytet z terminal-delete konta,
    // user-mutations.operations.ts). Cleanup fire-and-forget PO udanej transakcji.
    let orphanedAssetUrls: string[] = [];

    // Revoke-race barrier: re-confirm ACTIVE pairing UNDER A ROW LOCK in the SAME tx as the
    // delete (identycznie jak create/update wyżej).
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

        // DECISION (nie usuwaj tego komentarza): usuwalne są TYLKO wizyty source=MANUAL —
        // to naprawa własnej pomyłki stylistki. Wpisy source=SESSION to automatyczny zapis
        // faktu (zamknięta sesja) i nie mają legalnej ścieżki usunięcia z UI; ich kasowanie
        // to osobna polityka danych (post-MVP, np. „ukryj"). deleteMany z filtrem source
        // zwraca count=0 dla nie-manualnych → VISIT_NOT_FOUND (ten sam anty-oracle co
        // w requireVisitAccess_IO — nie ujawniamy, czy wpis istnieje poza regułą).
        // Zdjęcia efektu schodzą kaskadą (FK VisitResultPhoto ON DELETE CASCADE).
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

      // findUnique (nie ...OrThrow): update i refetch to dwa round-tripy. Gdy wizyta
      // zniknie między nimi (np. cascade z usunięcia konta klientki), null → VISIT_NOT_FOUND
      // zamiast generycznego DATABASE_ERROR z rzuconego P2025.
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

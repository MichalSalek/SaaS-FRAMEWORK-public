import { DB_CLIENT } from '@app/db/db.client';
import { lockActivePair, lockInOrder } from '@app/db/lock-rows';
import { visitWriteLockPlan } from '@app/db/lock-plans';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { clientPairAccessIsCurrent } from '@domain/pairing/pair-access-current';
import { TIME } from '@kernel/application/constants.config';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ClientUnauthorizedAccessError } from '@kernel/domain/client/client-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type {
  ClientCardPlanLockedError,
  VisitNotFoundError,
} from '@kernel/domain/visit/visit-errors.types';
import type { HistoryAccessDTO } from '@kernel/models/pricing/history-access.dto';
import {
  PairingStatusValue,
  type VisitRecordSource,
} from '@kernel/models/db_models.generated.dto';
import type {
  VisitRecordDTO,
  VisitResultPhotoDTO,
} from '@kernel/models/visit/visit.dto';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { Prisma } from '../../../prisma/js-client';

export const VISIT_LIST_MAX_TAKE = 50;
export const VISIT_LIST_DEFAULT_TAKE = 20;

// One shape for loading result photos on EVERY path that returns a VisitRecordDTO (list, create,
// refetch after update-note): the position -> created_at order is part of the DTO contract
// (resultPhotos[i].position ascends). Prisma.validator keeps the literal type (the payload is inferred
// at each call site) and checks the shape here.
export const VISIT_RESULT_PHOTOS_INCLUDE =
  Prisma.validator<Prisma.VisitRecordInclude>()({
    result_photos: {
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    },
  });

export type DbVisitResultPhoto = {
  id: string;
  visit_record_id: string;
  asset_url: string;
  position: number;
  created_at: Date;
};

export type DbVisitRecordWithPhotos = {
  id: string;
  client_user_id: string;
  visit_date: Date;
  service_note: string | null;
  source: VisitRecordSource;
  session_id: string | null;
  created_at: Date;
  result_photos: DbVisitResultPhoto[];
};

export type VisitAccessError =
  | VisitNotFoundError
  | ClientUnauthorizedAccessError
  | ClientCardPlanLockedError
  | DatabaseError;

export const mapPhotoToDTO = (
  photo: DbVisitResultPhoto
): VisitResultPhotoDTO => ({
  id: photo.id,
  visitRecordId: photo.visit_record_id,
  assetUrl: photo.asset_url,
  position: photo.position,
  createdAt: photo.created_at.toISOString(),
});

export const mapVisitToDTO = (
  visit: DbVisitRecordWithPhotos
): VisitRecordDTO => ({
  id: visit.id,
  clientUserId: visit.client_user_id,
  visitDate: visit.visit_date.toISOString(),
  serviceNote: visit.service_note,
  source: visit.source,
  sessionId: visit.session_id,
  resultPhotos: visit.result_photos.map(mapPhotoToDTO),
  createdAt: visit.created_at.toISOString(),
});

export const normalizeNullableText = (
  value: string | undefined
): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const getHistoryAccess = (
  pricingPlan: PricingPlan
): HistoryAccessDTO => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  const canViewHistory = PRICING_POLICY.utils.canViewHistory(planConfig);
  return {
    isLocked: !canViewHistory,
    canViewHistory,
    retentionDays: PRICING_POLICY.utils.getHistoryRetentionDays(planConfig),
  };
};

export const assertHistoryAccess = (
  pricingPlan: PricingPlan
): OperationResult<HistoryAccessDTO, ClientCardPlanLockedError> => {
  const historyAccess = getHistoryAccess(pricingPlan);
  if (!historyAccess.canViewHistory) {
    return failure({
      type: 'CLIENT_CARD_PLAN_LOCKED',
      planType: pricingPlan,
    });
  }
  return success(historyAccess);
};

export const findActivePairing = async ({
  client_user_id,
  stylist_account_id,
  tx,
}: {
  client_user_id: string;
  stylist_account_id: string;
  tx?: Prisma.TransactionClient;
}) => {
  const pair = await (tx ?? DB_CLIENT.use).clientStylistPair.findFirst({
    where: {
      client_user_id,
      stylist_account_id,
      status: PairingStatusValue.ACTIVE,
      client_user: { is_active: true },
    },
    select: { id: true, salon_origin_account_id: true },
  });
  return pair &&
    (await clientPairAccessIsCurrent(
      pair,
      client_user_id,
      stylist_account_id,
      tx
    ))
    ? pair
    : null;
};

export const requireActivePairing_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<true, ClientUnauthorizedAccessError | DatabaseError>
> => {
  try {
    const pairing = await findActivePairing({
      client_user_id,
      stylist_account_id,
    });
    if (!pairing) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }
    return success(true);
  } catch (error) {
    return databaseFailure('requireActivePairing_IO', error);
  }
};

// DECISION: in-transaction revoke barrier for write paths. The pairing check runs outside the tx, so a
// revoke can commit before the write. FOR UPDATE on the active pair inside the tx makes the revoke wait
// or excludes the revoked row (null, CLIENT_UNAUTHORIZED_ACCESS). requireActiveClient mirrors is_active
// and does not lock users, so a soft-delete is narrowed, not closed (lock-rows.ts). Lock the pair before
// VisitRecord. No test pins this barrier.

// DECISION: KEY SHARE on the pair's users row and StylistAccount before the pair lock
// (visitWriteLockPlan). The insert's FK check takes them after the pair lock and deadlocked with revoke
// (LOCK_GRAPH.md C2). KEY SHARE conflicts only with FOR UPDATE and DELETE. Every visit write uses it.
// Test: tests/concurrency/lock-order.concurrency.ts (covers the C2 cycle under barrier-forced
// interleavings; not other lock pairs).
export const requireActivePairingLocked_IO = async (
  tx: Prisma.TransactionClient,
  client_user_id: string,
  stylist_account_id: string
): Promise<OperationResult<true, ClientUnauthorizedAccessError>> => {
  await lockInOrder(tx, visitWriteLockPlan(client_user_id, stylist_account_id));
  const pairing = await lockActivePair(tx, client_user_id, stylist_account_id, {
    requireActiveClient: true,
  });
  const pair = pairing
    ? await tx.clientStylistPair.findUnique({
        where: { id: pairing.id },
        select: { salon_origin_account_id: true },
      })
    : null;
  if (
    !pair ||
    !(await clientPairAccessIsCurrent(
      pair,
      client_user_id,
      stylist_account_id,
      tx
    ))
  ) {
    return failure({
      type: 'CLIENT_UNAUTHORIZED_ACCESS',
      clientId: client_user_id,
      stylistAccountId: stylist_account_id,
    });
  }
  return success(true);
};

// Retention window cutoff shared by the read filter (buildVisitWhere) and the
// write gate (requireVisitAccess_IO) so both paths compute the boundary once.
// retentionDays <= 0 means "no cutoff": FREE (0) never reaches here (canViewHistory
// gate rejects earlier), full-history plans use -1.
export const retentionCutoff = (retentionDays: number): Date | null =>
  retentionDays > 0
    ? new Date(Date.now() - retentionDays * TIME.MS_PER_DAY)
    : null;

export const buildVisitWhere = ({
  client_user_id,
  stylist_account_id,
  retentionDays,
}: {
  client_user_id: string;
  stylist_account_id: string;
  retentionDays: number;
}): Prisma.VisitRecordWhereInput => {
  const cutoff = retentionCutoff(retentionDays);

  return {
    client_user_id,
    stylist_account_id,
    ...(cutoff && { visit_date: { gte: cutoff } }),
  };
};

export const loadVisitForStylist_IO = async ({
  visit_id,
  stylist_account_id,
}: {
  visit_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    { id: string; client_user_id: string; visit_date: Date },
    VisitNotFoundError | DatabaseError
  >
> => {
  try {
    const visit = await DB_CLIENT.use.visitRecord.findFirst({
      where: { id: visit_id, stylist_account_id },
      select: { id: true, client_user_id: true, visit_date: true },
    });
    if (!visit) {
      return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
    }
    return success(visit);
  } catch (error) {
    return databaseFailure('loadVisitForStylist', error);
  }
};

export const requireVisitAccess_IO = async ({
  visit_id,
  stylist_account_id,
  stylist_pricing_plan,
  purpose = 'content',
}: {
  visit_id: string;
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  /**
   * 'content' (default): the operation may return visit content, so the retention
   * cutoff applies. 'destructive': the operation only deletes and returns no content,
   * so the cutoff does not apply. Rationale: the DECISION at the cutoff below.
   */
  purpose?: 'content' | 'destructive';
}): Promise<OperationResult<{ client_user_id: string }, VisitAccessError>> => {
  // DECISION: the PLAN gate applies, like the retention cutoff below, ONLY to paths that return CONTENT.
  // The `purpose: 'destructive'` exemption used to exist only at the cutoff while this gate ran first and
  // ignored `purpose`, so a downgrade to a plan without history (the end of the 30-day Pro trial is the
  // default path) froze visits and photos: not viewable AND not deletable, with no way to honor a deletion
  // request. The tier regulates VIEWING, not the right to delete, and the stylist is the controller of this
  // personal data. Deleting returns no content field (only `{success:true}`), so the exemption creates no
  // read oracle.
  const historyAccess = getHistoryAccess(stylist_pricing_plan);
  if (purpose !== 'destructive' && !historyAccess.canViewHistory) {
    return failure({
      type: 'CLIENT_CARD_PLAN_LOCKED',
      planType: stylist_pricing_plan,
    });
  }

  const visit = await loadVisitForStylist_IO({ visit_id, stylist_account_id });
  if (!visit.success) {
    return visit;
  }

  const cutoff = retentionCutoff(historyAccess.retentionDays);
  if (purpose !== 'destructive' && cutoff && visit.data.visit_date < cutoff) {
    return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
  }

  const pairing = await requireActivePairing_IO({
    client_user_id: visit.data.client_user_id,
    stylist_account_id,
  });
  if (!pairing.success) {
    return pairing;
  }

  return success({ client_user_id: visit.data.client_user_id });
};

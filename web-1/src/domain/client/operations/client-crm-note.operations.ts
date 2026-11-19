import { DB_CLIENT } from '@app/db/db.client';
import { lockActivePair } from '@app/db/lock-rows';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ClientUnauthorizedAccessError } from '@kernel/domain/client/client-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { ClientCardPlanLockedError } from '@kernel/domain/visit/visit-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import {
  getCrmNoteEditLimit,
  VISIT_CONFIG,
} from '@kernel/domain/visit/visit.config';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { clientPairAccessIsCurrent } from '@domain/pairing/pair-access-current';

type ClientCrmNoteResult = {
  note: string | null;
  updatedAt: string | null;
};

type ClientCrmNoteError =
  | ClientUnauthorizedAccessError
  | ClientCardPlanLockedError
  | DatabaseError
  | ValidationError;

const normalizeCrmNote = (note: string): string | null => {
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertClientCardAccess = (
  pricingPlan: PricingPlan
): OperationResult<true, ClientCardPlanLockedError> => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  if (!PRICING_POLICY.utils.canViewHistory(planConfig)) {
    return failure({
      type: 'CLIENT_CARD_PLAN_LOCKED',
      planType: pricingPlan,
    });
  }
  return success(true);
};

const loadActivePair = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}) =>
  DB_CLIENT.use.clientStylistPair.findFirst({
    where: {
      client_user_id,
      stylist_account_id,
      status: PairingStatusValue.ACTIVE,
      client_user: { is_active: true },
    },
    select: {
      id: true,
      salon_origin_account_id: true,
      crm_note: true,
      crm_note_updated_at: true,
    },
  });

export const getClientCrmNote_IO = async ({
  stylist_account_id,
  client_user_id,
  stylist_pricing_plan,
}: {
  stylist_account_id: string;
  client_user_id: string;
  stylist_pricing_plan: PricingPlan;
}): Promise<OperationResult<ClientCrmNoteResult, ClientCrmNoteError>> => {
  const access = assertClientCardAccess(stylist_pricing_plan);
  if (!access.success) {
    return access;
  }

  try {
    const pair = await loadActivePair({ client_user_id, stylist_account_id });
    if (
      !pair ||
      !(await clientPairAccessIsCurrent(
        pair,
        client_user_id,
        stylist_account_id
      ))
    ) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }

    return success({
      note: pair.crm_note,
      updatedAt: pair.crm_note_updated_at?.toISOString() ?? null,
    });
  } catch (error) {
    return databaseFailure('getClientCrmNote_IO', error);
  }
};

export const upsertClientCrmNote_IO = async ({
  stylist_account_id,
  client_user_id,
  stylist_pricing_plan,
  note,
  expected_updated_at,
}: {
  stylist_account_id: string;
  client_user_id: string;
  stylist_pricing_plan: PricingPlan;
  note: string;
  expected_updated_at?: string | null;
}): Promise<OperationResult<ClientCrmNoteResult, ClientCrmNoteError>> => {
  const normalized = normalizeCrmNote(note);

  // DECISION: an empty note is a DELETE request and is the only write allowed on a plan without
  // client-card access (parity with `purpose: 'destructive'` for visits): the tier governs viewing,
  // not deletion. Otherwise a downgrade leaves the stylist with personal data she can neither see
  // nor delete. No read oracle: the delete branch writes and returns null. Non-empty writes stay
  // behind the plan gate.
  if (normalized !== null) {
    const access = assertClientCardAccess(stylist_pricing_plan);
    if (!access.success) {
      return access;
    }
  }

  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      const unauthorized = {
        type: 'CLIENT_UNAUTHORIZED_ACCESS' as const,
        clientId: client_user_id,
        stylistAccountId: stylist_account_id,
      };
      const locked = await lockActivePair(
        tx,
        client_user_id,
        stylist_account_id,
        {
          requireActiveClient: true,
        }
      );
      if (!locked) {
        return failure(unauthorized);
      }
      const baseline = await tx.clientStylistPair.findUnique({
        where: { id: locked.id },
        select: {
          crm_note: true,
          crm_note_updated_at: true,
          salon_origin_account_id: true,
        },
      });
      if (
        !baseline ||
        !(await clientPairAccessIsCurrent(
          baseline,
          client_user_id,
          stylist_account_id,
          tx
        ))
      ) {
        return failure(unauthorized);
      }
      const revision = baseline.crm_note_updated_at?.toISOString() ?? null;
      const stale =
        expected_updated_at === undefined
          ? countCodePoints(baseline.crm_note ?? '') >
            VISIT_CONFIG.CRM_NOTE_LEGACY_MAX
          : expected_updated_at !== revision;
      if (stale) {
        return failure({
          type: 'VALIDATION_ERROR' as const,
          field: 'note',
          message: VALIDATION_MESSAGES.visit.crmNoteChanged,
        });
      }
      if (countCodePoints(note) > getCrmNoteEditLimit(baseline.crm_note)) {
        return failure({
          type: 'VALIDATION_ERROR' as const,
          field: 'note',
          message: VALIDATION_MESSAGES.visit.crmNoteTooLong,
        });
      }
      const updatedAt = new Date(
        Math.max(Date.now(), (baseline.crm_note_updated_at?.getTime() ?? 0) + 1)
      );
      const updateResult = await tx.clientStylistPair.updateMany({
        where: {
          client_user_id,
          stylist_account_id,
          status: PairingStatusValue.ACTIVE,
          client_user: { is_active: true },
        },
        data: {
          crm_note: normalized,
          crm_note_updated_at: updatedAt,
        },
      });
      if (updateResult.count === 0) {
        return failure(unauthorized);
      }

      return success({
        note: normalized,
        updatedAt: updatedAt.toISOString(),
      });
    });
  } catch (error) {
    return databaseFailure('upsertClientCrmNote_IO', error);
  }
};

/**
 * Deleting a CRM note: the stylist's own data.
 *
 * DECISION: the only gate is ownership of the pair row (client_user_id + stylist_account_id from
 * the session), with no `status: ACTIVE`, no `client_user.is_active` and no plan gate: a note may
 * be deleted on a PENDING/REVOKED pair and for an inactive client, because the tier governs
 * viewing, not the right to delete own data. Retention after revocation is unchanged; only this
 * explicit action deletes. The response is the state after the operation (`note: null`), never a
 * count: `deleted: true/false` would reveal whether any pair row exists for a client_user_id.
 */
export const deleteClientCrmNote_IO = async ({
  stylist_account_id,
  client_user_id,
}: {
  stylist_account_id: string;
  client_user_id: string;
}): Promise<
  OperationResult<{ note: null; updatedAt: null }, DatabaseError>
> => {
  try {
    await DB_CLIENT.use.clientStylistPair.updateMany({
      where: { client_user_id, stylist_account_id },
      data: { crm_note: null, crm_note_updated_at: null },
    });
    return success({ note: null, updatedAt: null });
  } catch (error) {
    return databaseFailure('deleteClientCrmNote_IO', error);
  }
};

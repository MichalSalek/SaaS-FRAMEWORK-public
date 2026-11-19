import { finishFreeForSalonOwners_IO } from '@domain/email/operations/free-email.salon-access';
import type {
  StylistAccount,
  User,
} from '@kernel/models/db_models.generated.dto';
import { PaymentStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  assertType,
  isPaymentStatusNarrower,
  isPricingPlanNarrower,
  narrowUser,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { DB_CLIENT } from '@app/db/db.client';
import { userRelationsEnabler } from '@domain/user/user.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * Account Operations (payment, activation, state management)
 */

/**
 * Set payment state (pricing plan, payment status, expiration dates)
 */
export const setPaymentStateByUserID_IO = async ({
  id,
  pricing_plan,
  adminPlanOverride = false,
}: {
  id: User['id'];
  pricing_plan: StylistAccount['pricing_plan'];
  // OWNER-001: when set, admin_plan_override is written in the SAME nested
  // stylist_account.update as pricing_plan/payment_status — atomic, so a paid
  // plan can never persist without its override flag (previously a separate
  // non-atomic write in adminChangePricingPlan_IO). Default false = no-op for
  // non-admin (Stripe-webhook) callers, which never set the override.
  adminPlanOverride?: boolean;
}): Promise<
  OperationResult<UserWithRelations, UserNotFoundError | DatabaseError>
> => {
  // DECISION: Stripe is the only owner of account_expiration_date / upcoming_payment_date. The admin
  // paid-plan path does not estimate now+30d; it sets null and defers to the subscription.updated webhook.
  //
  // DECISION: FREE implies UNPAID. payment_status is not hardcoded PAID: FREE carries no payment, so an
  // admin-set FREE MUST give UNPAID (a FREE+PAID+override row contradicts the rest of the system, where
  // FREE <=> UNPAID). This IO is ADMIN-ONLY (sole caller adminChangePricingPlan_IO via the
  // user-administration facade); Stripe-webhook paths go through updateAccountPlanStatus and are untouched.
  const targetPaymentStatus =
    pricing_plan === PricingPlanValue.FREE
      ? PaymentStatusValue.UNPAID
      : PaymentStatusValue.PAID;
  let outputUserRaw;
  try {
    outputUserRaw = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          stylist_account: {
            update: {
              payment_status: assertType(
                targetPaymentStatus,
                isPaymentStatusNarrower,
                'payment status'
              ),
              account_expiration_date: null,
              upcoming_payment_date: null,
              pricing_plan: assertType(
                pricing_plan,
                isPricingPlanNarrower,
                'pricing_plan in setPaymentStateByUserID_IO'
              ),
              ...(adminPlanOverride && { admin_plan_override: true }),
            },
          },
        },
        include: userRelationsEnabler,
      });
      if (pricing_plan === 'STUDIO' || pricing_plan === 'SCALE') {
        await finishFreeForSalonOwners_IO(tx, [id]);
      }
      return updated;
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: id });
    }
    return databaseFailure('setPaymentStateByUserID_IO', error);
  }

  const narrowedUserResult = narrowUser<UserWithRelations>(
    outputUserRaw,
    'setPaymentStateByUserID_IO'
  );
  if (!narrowedUserResult) {
    return failure({
      type: 'DATABASE_ERROR',
      operation: 'setPaymentStateByUserID: user not found after update',
    });
  }
  return success(narrowedUserResult);
};

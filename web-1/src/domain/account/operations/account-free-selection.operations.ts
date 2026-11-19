import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  CheckoutAttemptBusyError,
  CheckoutFreePlanConflictError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
  type SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { casUpdate } from '@app/db/cas';
import { CHECKOUT_FREE_FENCED_UPDATE_SQL } from './account-free-selection.sql';

// DECISION: an active paid subscription = subscription_id set AND an access-granting status
// (ACTIVE/TRIALING/PAST_DUE, mirrors STRIPE_ACTIVE_STATUSES). A downgrade from paid goes through
// the portal/cancel flow, never through this Free branch.
const ACTIVE_PAID_SUBSCRIPTION_STATUS_LIST: readonly SubscriptionStatus[] = [
  SubscriptionStatusValue.ACTIVE,
  SubscriptionStatusValue.TRIALING,
  SubscriptionStatusValue.PAST_DUE,
];
const ACTIVE_PAID_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> =
  new Set(ACTIVE_PAID_SUBSCRIPTION_STATUS_LIST);

export const selectFreePlan_IO = async ({
  userId,
  checkoutLease,
}: {
  userId: string;
  checkoutLease?: { accountId: string; owner: string };
}): Promise<
  OperationResult<
    Record<string, never>,
    | CheckoutFreePlanConflictError
    | CheckoutAttemptBusyError
    | AccountNotFoundError
    | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        stylist_account: {
          select: {
            account_id: true,
            subscription_id: true,
            subscription_status: true,
          },
        },
      },
    });
  } catch (error) {
    return databaseFailure('selectFreePlan:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  const account = user.stylist_account;
  if (checkoutLease && checkoutLease.accountId !== account.account_id) {
    return failure({
      type: 'CHECKOUT_ATTEMPT_BUSY',
      accountId: account.account_id,
      retryAfterSeconds: 1,
    });
  }

  const hasActivePaidSubscription =
    account.subscription_id != null &&
    account.subscription_status != null &&
    ACTIVE_PAID_SUBSCRIPTION_STATUSES.has(account.subscription_status);

  if (hasActivePaidSubscription) {
    return failure({
      type: 'CHECKOUT_FREE_PLAN_CONFLICT',
      accountId: account.account_id,
    });
  }

  // DECISION: two steps in one transaction.
  // (1) CAS write guarded by "no active paid subscription AT WRITE TIME": a Stripe webhook can
  //     activate a subscription between our read and write, and an unconditional update would
  //     clobber it back to FREE. count === 0 is classified by a re-fetch (NOT_FOUND vs CONFLICT).
  //     current_period_end=null takes the account out of the expiry sweep's EXPIRED predicate, which
  //     would otherwise re-expire it the next day. last_stripe_event_at is untouched (not a Stripe
  //     event).
  // (2) Reactivate to ACTIVE only from EXPIRED/EXPIRING and only when created_by_user.is_active,
  //     matching the automatic free transitions. NOT_ACTIVE is left alone on purpose: moderation
  //     bans, admin disable and charge-dispute holds set it, and choosing Free must not lift them.
  //     subscription_id/status stay as they are (nulling a possibly live sub risks an orphan).
  let updatedCount;
  try {
    updatedCount = await DB_CLIENT.use.$transaction(async tx => {
      const primaryCount = checkoutLease
        ? await tx.$executeRawUnsafe(
            CHECKOUT_FREE_FENCED_UPDATE_SQL,
            account.account_id,
            checkoutLease.owner
          )
        : await casUpdate(() =>
            tx.stylistAccount.updateMany({
              where: {
                account_id: account.account_id,
                OR: [
                  { subscription_id: null },
                  { subscription_status: null },
                  {
                    subscription_status: {
                      notIn: [...ACTIVE_PAID_SUBSCRIPTION_STATUS_LIST],
                    },
                  },
                ],
              },
              data: {
                pricing_plan: PricingPlanValue.FREE,
                payment_status: PaymentStatusValue.UNPAID,
                current_period_end: null,
                plan_selected_at: new Date(),
              },
            })
          );

      if (primaryCount > 0) {
        await tx.stylistAccount.updateMany({
          where: {
            account_id: account.account_id,
            account_status: {
              in: [AccountStatusValue.EXPIRED, AccountStatusValue.EXPIRING],
            },
            created_by_user: { is_active: true },
          },
          data: { account_status: AccountStatusValue.ACTIVE },
        });
      }

      return primaryCount;
    });
  } catch (error) {
    return databaseFailure('selectFreePlan:update', error);
  }

  if (updatedCount === 0) {
    if (checkoutLease) {
      return failure({
        type: 'CHECKOUT_ATTEMPT_BUSY',
        accountId: account.account_id,
        retryAfterSeconds: 1,
      });
    }
    let recheck;
    try {
      recheck = await DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: account.account_id },
        select: { account_id: true },
      });
    } catch (error) {
      return databaseFailure('selectFreePlan:reclassify', error);
    }
    if (!recheck) {
      return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
    }
    return failure({
      type: 'CHECKOUT_FREE_PLAN_CONFLICT',
      accountId: account.account_id,
    });
  }

  return success({});
};

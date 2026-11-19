import { finishSalonInvitationsAfterReactivation } from '@domain/salon-staff/salon-invitation-token.service';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import {
  EventLogTypeValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';
import type {
  BulkActionResult,
  BulkLogoutResult,
} from '@kernel/models/admin/admin.dto';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import {
  cascadeBulkDisableAccountStatus,
  cascadeBulkEnableAccountStatus,
} from './admin-bulk-cascade.helper';
import {
  enqueueBulkCancelReconcileRows,
  type BulkCancelReconcileTarget,
} from './admin-bulk-cancel-reconcile.helper';

type BulkOperationError = AdminInsufficientPermissionsError | DatabaseError;

// How many Stripe cancellations run in parallel in a bulk downgrade to FREE.
// Rationale for the value: the DECISION at the runWithConcurrency call below.
const BULK_STRIPE_CANCEL_CONCURRENCY = 5;

/**
 * Filter out admin users from target IDs.
 * Returns { nonAdminIds, skippedAdminIds }
 */
const filterAdminUsers = async (
  userIds: string[]
): Promise<{
  nonAdminIds: string[];
  skippedAdminCount: number;
  foundUserIds: string[];
}> => {
  const users = await DB_CLIENT.use.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role_id: true },
    take: 500,
  });

  const foundUserIds = users.map(u => u.id);
  const nonAdminIds = users
    .filter(u => u.role_id !== SystemRoleId.MASTER_ADMIN)
    .map(u => u.id);
  const skippedAdminCount = users.filter(
    u => u.role_id === SystemRoleId.MASTER_ADMIN
  ).length;

  return { nonAdminIds, skippedAdminCount, foundUserIds };
};

/**
 * Not-found errors for a bulk action: every UNIQUE requested id absent from the
 * DB lookup. Deduped on `new Set(userIds)` (raw user_ids may repeat) and matched
 * against foundUserIds (already deduped by the `IN` findMany). Single source for
 * the three bulk ops (disable / enable / change-plan).
 */
const collectNotFoundErrors = (
  userIds: string[],
  foundUserIds: string[]
): BulkActionResult['errors'] => {
  const foundSet = new Set(foundUserIds);
  const errors: BulkActionResult['errors'] = [];
  for (const id of new Set(userIds)) {
    if (!foundSet.has(id)) {
      errors.push({ user_id: id, reason: 'User not found' });
    }
  }
  return errors;
};

/**
 * Admin bulk disable users
 */
export const adminBulkDisable_IO = async ({
  user_ids,
  currentUser,
}: {
  user_ids: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkActionResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, skipped: 0, errors: [] });
  }

  try {
    const { nonAdminIds, skippedAdminCount, foundUserIds } =
      await filterAdminUsers(user_ids);
    // DECISION: not_found_count is computed from unique ids. foundUserIds comes from an `IN`
    // findMany, which collapses duplicates, so raw `user_ids.length` would overcount ([X, X, Y] gives 1).
    const uniqueUserIds = new Set(user_ids);
    const notFoundCount = uniqueUserIds.size - foundUserIds.length;

    const errors: BulkActionResult['errors'] = [];
    // Each unknown id is reported once even when the input repeats it (collectNotFoundErrors).
    errors.push(...collectNotFoundErrors(user_ids, foundUserIds));

    // DECISION: user.updateMany, the account_status cascade and session.deleteMany run in ONE
    // interactive $transaction. A partial failure between them left a disabled account publicly
    // visible (account_status still ACTIVE) or with live sessions. take:500 in filterAdminUsers
    // bounds the tx duration.
    const result = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: { in: nonAdminIds }, is_active: true },
        data: { is_active: false, disabled_at: new Date() },
      });

      // Public profile, directory and sitemap gate on account_status, not on is_active.
      await cascadeBulkDisableAccountStatus(tx, nonAdminIds);

      // DECISION: sessions are evicted in the same tx as the disable; otherwise the user keeps
      // tokens for up to 48h (SESSION_EXPIRES_IN_SECONDS), held back only by account-state-guard.
      // Do NOT add revokeImpersonationOnEviction here (unlike single-op disableUser_IO):
      // filterAdminUsers excludes MASTER_ADMIN, so no target owns a backup row. A disabled
      // impersonated target loses its impersonation session through this deleteMany; the leftover
      // backup row is unredeemable (caller binding needs that session) and is swept daily.
      await tx.session.deleteMany({
        where: { userId: { in: nonAdminIds } },
      });

      return updated;
    });

    // runAfterResponse wraps the fire-and-forget audit write: on Vercel it uses waitUntil() to
    // keep the function alive until the DB insert lands; on Render/Node it falls back to a
    // floating promise. Keeps an Edge runtime from killing the insert after the response is sent.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_DISABLE_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_DISABLE',
          target_ids: nonAdminIds,
          affected_count: result.count,
          skipped_admin_count: skippedAdminCount,
          not_found_count: notFoundCount,
        },
      })
    );

    return success({
      affected: result.count,
      skipped: skippedAdminCount,
      errors,
    });
  } catch (error) {
    return databaseFailure('adminBulkDisable_IO', error);
  }
};

/**
 * Admin bulk enable users
 */
export const adminBulkEnable_IO = async ({
  user_ids,
  currentUser,
}: {
  user_ids: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkActionResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, skipped: 0, errors: [] });
  }

  try {
    const { nonAdminIds, skippedAdminCount, foundUserIds } =
      await filterAdminUsers(user_ids);

    const errors: BulkActionResult['errors'] = [];
    // user_ids are deduped; see the comment in adminBulkDisable_IO.
    errors.push(...collectNotFoundErrors(user_ids, foundUserIds));

    // DECISION: WHERE requires `deleted_at: null`. Otherwise bulk-enable would clear deleted_at and
    // recovery_available on soft-deleted rows, resurrecting an account the user asked to delete and
    // destroying the soft-delete marker (DOMAIN_SSOT §13.1: deleted_at is cleared only by the recovery
    // state machine). Soft-deleted accounts come back only through reactivateAccount_IO.
    // DECISION: data clears `disabled_at` in lockstep with is_active, like enableUser_IO.
    // Consumers filter on (is_active: true AND disabled_at: null), so a stale disabled_at leaves a
    // re-enabled user invisible to them (salon lookups, email-change confirm) while
    // account-state-guard, which ignores disabled_at, still lets them log in.
    // Same single-transaction atomicity as bulk disable (user update + account_status cascade).
    const result = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: { in: nonAdminIds }, is_active: false, deleted_at: null },
        data: {
          is_active: true,
          disabled_at: null,
          deleted_at: null,
          recovery_available: false,
        },
      });

      // Restores account_status=ACTIVE only for eligible accounts; the gate lives in
      // cascadeBulkEnableAccountStatus (admin-bulk-cascade.helper.ts).
      await cascadeBulkEnableAccountStatus(tx, nonAdminIds);

      return updated;
    });

    // DECISION: see salon-invitation-token.service.ts (an active account again finishes both sides).
    // Never throws; sequential on purpose (at most VALIDATION_BULK.MAX_USER_IDS accounts).
    for (const userId of nonAdminIds) {
      await finishSalonInvitationsAfterReactivation(
        userId,
        'admin bulk enable'
      );
    }

    // runAfterResponse: see the BULK_DISABLE_SUCCESS comment above.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_ENABLE_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_ENABLE',
          target_ids: nonAdminIds,
          affected_count: result.count,
          skipped_admin_count: skippedAdminCount,
        },
      })
    );

    return success({
      affected: result.count,
      skipped: skippedAdminCount,
      errors,
    });
  } catch (error) {
    return databaseFailure('adminBulkEnable_IO', error);
  }
};

/**
 * Admin bulk change pricing plan
 * Skips users without stylist_account (reported in errors)
 */
export const adminBulkChangePlan_IO = async ({
  user_ids,
  pricing_plan,
  currentUser,
}: {
  user_ids: string[];
  pricing_plan: PricingPlan;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkActionResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, skipped: 0, errors: [] });
  }

  try {
    const { nonAdminIds, skippedAdminCount, foundUserIds } =
      await filterAdminUsers(user_ids);

    const errors: BulkActionResult['errors'] = [];
    // user_ids are deduped; see the comment in adminBulkDisable_IO.
    errors.push(...collectNotFoundErrors(user_ids, foundUserIds));

    // Find which non-admin users have stylist accounts (+ the owner role)
    const stylistAccounts = await DB_CLIENT.use.stylistAccount.findMany({
      where: { created_by_user_id: { in: nonAdminIds } },
      select: {
        created_by_user_id: true,
        // subscription_id: needed to persist the "cancel this subscription" obligation in the
        // same commit as the plan flip (see admin-bulk-cancel-reconcile.helper).
        subscription_id: true,
        created_by_user: { select: { role_id: true, deleted_at: true } },
      },
      take: 500,
    });
    const accountsByUserId = new Map(
      stylistAccounts.map(sa => [sa.created_by_user_id, sa])
    );

    // Role guard (parity with the single-op adminChangePricingPlan_IO, see the DECISION in
    // admin-user-management.operations.ts): a pricing plan applies ONLY to stylist accounts.
    // switchRole STYLIST->CLIENT leaves an orphaned stylist_account (user-onboarding.operations.ts),
    // so a bare JOIN on created_by_user_id caught orphans and silently raised a role_client account
    // to PAID/PRO (domain-invariant violation). Rejected ids are reported in errors[] (same format
    // as 'User not found').
    // DECISION: soft-deleted accounts (deleted_at set) are excluded from eligibleIds, like
    // bulk-enable and adminChangePricingPlan_IO. The cascade helper filters them, but nothing else
    // would stop the pricing_plan/payment_status write on a soft-deleted account (DOMAIN_SSOT §13.1).
    const eligibleIds: string[] = [];
    for (const id of nonAdminIds) {
      const account = accountsByUserId.get(id);
      if (!account) {
        errors.push({ user_id: id, reason: 'No stylist account' });
      } else if (
        account.created_by_user.role_id !== SystemRoleId.STYLIST_ROLE
      ) {
        errors.push({
          user_id: id,
          reason: 'Not a stylist (orphan stylist account)',
        });
      } else if (account.created_by_user.deleted_at !== null) {
        errors.push({ user_id: id, reason: 'User is deleted' });
      } else {
        eligibleIds.push(id);
      }
    }

    // Accounts that had a LIVE subscription at qualification: only they get a Stripe
    // cancellation obligation from a downgrade to FREE.
    const cancelReconcileTargets: BulkCancelReconcileTarget[] =
      pricing_plan === PricingPlanValue.FREE
        ? eligibleIds.flatMap(id => {
            const subscriptionId =
              accountsByUserId.get(id)?.subscription_id ?? null;
            return subscriptionId === null
              ? []
              : [{ userId: id, subscriptionId }];
          })
        : [];

    const result = await DB_CLIENT.use.$transaction(async tx => {
      const planResult = await tx.stylistAccount.updateMany({
        where: { created_by_user_id: { in: eligibleIds } },

        data: {
          pricing_plan,
          admin_plan_override: true,
          payment_status:
            pricing_plan === PricingPlanValue.FREE
              ? PaymentStatusValue.UNPAID
              : PaymentStatusValue.PAID,
          account_expiration_date: null,
          upcoming_payment_date: null,
        },
      });

      // DECISION: setting payment_status=PAID does not flip account_status, and nothing else will:
      // account-expiry-sweep only downgrades and syncAccountWithStripe skips admin_plan_override
      // accounts. Without this step a lapsed (EXPIRED) stylist moved to PAID stays invisible in
      // discovery and pairing. The cascade's WHERE leaves disabled and soft-deleted accounts alone.
      await cascadeBulkEnableAccountStatus(tx, eligibleIds);

      // The durable "cancel this subscription" obligation is written in the same commit as the
      // FREE plan; rationale in the DECISIONs in admin-bulk-cancel-reconcile.helper.
      await enqueueBulkCancelReconcileRows(tx, cancelReconcileTargets);

      return planResult;
    });

    // DECISION: a downgrade to FREE must cancel live Stripe subscriptions, or Stripe keeps billing
    // accounts marked FREE. cancelStripeSubscriptionIfExists is never-throw and reads the
    // subscription fresh (it also catches one attached by webhook after qualification). It runs
    // outside the $transaction (no Stripe calls holding a DB tx); paid→paid goes through the portal.
    //
    // DECISION: cancels run through a pool of BULK_STRIPE_CANCEL_CONCURRENCY, not one task per user.
    // Up to VALIDATION_BULK.MAX_USER_IDS (100) simultaneous `subscriptions.cancel` hit Stripe's
    // ~100/s write limit, and every 429 retry chain ends in an EventLog error and an alert mail.
    // A pool of 5 is ~10 req/s and closes 100 accounts in ~10s; Postgres is not the bottleneck.
    // A tail cut by the SIGTERM drain is finished by the stripe-cancel-reconcile sweep from the
    // rows written in the tx above. runWithConcurrency needs a never-throw worker.
    if (pricing_plan === PricingPlanValue.FREE) {
      runAfterResponse(() =>
        runWithConcurrency(
          eligibleIds,
          BULK_STRIPE_CANCEL_CONCURRENCY,
          // 'duplicate' = the flavor of the row written in the transaction above:
          // success closes it, a final failure re-arms it with the real error.
          userId =>
            cancelStripeSubscriptionIfExists(userId, {
              reconcileFlavor: 'duplicate',
            })
        )
      );
    }

    // runAfterResponse: see the BULK_DISABLE_SUCCESS comment above.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_CHANGE_PLAN_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_CHANGE_PLAN',
          target_ids: eligibleIds,
          affected_count: result.count,
          skipped_admin_count: skippedAdminCount,
          new_plan: pricing_plan,
          admin_plan_override_set: true,
          // Accounts that entered the downgrade with a live subscription = durable cancel
          // obligations committed together with the plan.
          cancel_reconcile_enqueued: cancelReconcileTargets.length,
        },
      })
    );

    return success({
      affected: result.count,
      skipped: skippedAdminCount,
      errors,
    });
  } catch (error) {
    return databaseFailure('adminBulkChangePlan_IO', error);
  }
};

/**
 * Admin bulk logout users (delete all sessions)
 */
export const adminBulkLogout_IO = async ({
  user_ids,
  currentUser,
}: {
  user_ids: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<BulkLogoutResult, BulkOperationError>> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  if (user_ids.length === 0) {
    return success({ affected: 0, sessionsDeleted: 0 });
  }

  try {
    const { nonAdminIds, skippedAdminCount } = await filterAdminUsers(user_ids);

    // DECISION: no revokeImpersonationOnEviction here: filterAdminUsers excludes admins, so no
    // target is a mid-impersonation admin (unlike single-op deleteAllSessionsOfUser_IO). See the
    // same note in adminBulkDisable_IO.
    const result = await DB_CLIENT.use.session.deleteMany({
      where: { userId: { in: nonAdminIds } },
    });

    // runAfterResponse: see the BULK_DISABLE_SUCCESS comment above.
    runAfterResponse(() =>
      writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.BULK_LOGOUT_SUCCESS,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: { created_by_user_id: currentUser.id },
        eventPayloadToStringify: {
          action: 'BULK_LOGOUT',
          target_ids: nonAdminIds,
          sessions_deleted: result.count,
          skipped_admin_count: skippedAdminCount,
        },
      })
    );

    return success({
      affected: nonAdminIds.length,
      sessionsDeleted: result.count,
    });
  } catch (error) {
    return databaseFailure('adminBulkLogout_IO', error);
  }
};

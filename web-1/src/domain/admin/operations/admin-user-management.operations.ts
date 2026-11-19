import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { emitAdminUserAudit } from '@domain/admin/operations/admin-user-audit.helper';
import type { IDType } from '@kernel/application/application.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
// User operations accessed via application-layer facade (not cross-domain import)
import {
  adminDisableUser as disableUser_IO,
  adminEnableUser as enableUser_IO,
  adminDeleteUser as deleteUser_IO,
  adminGetUser as getUser_IO,
  adminSetPaymentState as setPaymentStateByUserID_IO,
} from '@app/admin/user-administration.service';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
  AdminTargetProtectedError,
} from '@kernel/domain/admin/admin-errors.types';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  requireAdminPermission,
  requireTargetNotProtected,
} from '@domain/admin/admin.guards';
import { cascadeBulkEnableAccountStatus } from '@domain/admin/operations/admin-bulk-cascade.helper';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import { collectStylistAvatarUrlsForUser_IO } from '@domain/account/operations/account-avatar.operations';
import { collectVisitResultPhotoUrlsForUser_IO } from '@domain/visit/operations/visit-result-photo.operations';
import { cleanupNewsletterSubscriberByEmail } from '@domain/user/operations/user-mutations.operations';
import { eraseActorFromNotifications_IO } from '@domain/notifications/operations/notification-write.operations';
import { databaseFailure } from '@app/errors/error-result.helpers';

type DisableUserResponse = OperationResult<
  UserWithRelations | null,
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | UserNotFoundError
  | DatabaseError
>;

type EnableUserResponse = OperationResult<
  UserWithRelations | null,
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | UserNotFoundError
  | DatabaseError
>;

type ChangePricingPlanResponse = OperationResult<
  void,
  | AdminInsufficientPermissionsError
  | AdminTargetProtectedError
  | AdminTargetNotFoundError
  | UserNotFoundError
  | DatabaseError
>;

/**
 * Admin deletes any user
 */
export const adminDeleteUserAny_IO = async ({
  target_id,
  currentUser,
}: {
  target_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<DisableUserResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let userToBeDeleted;
  try {
    userToBeDeleted = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminDeleteUserAny_IO', error);
  }
  if (!userToBeDeleted) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  const deletedEmail = userToBeDeleted.email;

  // Cancel Stripe subscription before deletion (best-effort, non-blocking)
  await cancelStripeSubscriptionIfExists(userToBeDeleted.id);

  // Collect Cloudinary asset URLs before cascade-delete removes records
  let galleryRecords;
  try {
    galleryRecords = await DB_CLIENT.use.galleryRecord.findMany({
      where: { created_by_account: { created_by_user_id: userToBeDeleted.id } },
      select: { asset_url: true },
      take: 5000, // Safety cap — prevent OOM for power-user accounts (parity with deleteSelfUser_IO)
    });
  } catch (error) {
    return databaseFailure('adminDeleteUserAny_IO', error);
  }

  // Also collect VisitResultPhoto assets (karta klientki) — cascade removes them too, blobs would
  // otherwise orphan in Cloudinary (parity with gallery). Best-effort (returns [] on error).
  // The profile photo joined on 2026-09-09 (parity with self hard-delete). Both
  // sets are best-effort and independent, so they run in parallel.
  const [visitPhotoUrls, avatarUrls] = await Promise.all([
    collectVisitResultPhotoUrlsForUser_IO(userToBeDeleted.id),
    collectStylistAvatarUrlsForUser_IO(userToBeDeleted.id),
  ]);

  // Notifications v2 (Art. 17 parity with deleteSelfUser_IO): the name leaves
  // other people's notification rows before the account goes.
  await eraseActorFromNotifications_IO(userToBeDeleted.id);

  // Sessions go with the user: Session has onDelete: Cascade on its User FK.
  const deleteResult = await deleteUser_IO({ id: userToBeDeleted.id });
  if (!deleteResult.success) {
    // Only USER_NOT_FOUND becomes the admin 404; a DatabaseError (e.g. P2003) must stay a 500 instead
    // of hiding as a false "not found".
    if (deleteResult.error.type === 'USER_NOT_FOUND') {
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: userToBeDeleted.id,
        targetType: 'USER',
      });
    }
    return failure(deleteResult.error);
  }

  await cleanupNewsletterSubscriberByEmail(
    deletedEmail,
    'adminDeleteUserAny_IO',
    userToBeDeleted.id
  );

  const assetUrls = galleryRecords
    .map(r => r.asset_url)
    .concat(visitPhotoUrls, avatarUrls);
  if (assetUrls.length > 0) {
    cleanupCloudinaryAssets(assetUrls);
  }

  await emitAdminUserAudit(APP_EVENTS.INFO.USER.USER_DELETED, currentUser.id, {
    target_id: userToBeDeleted.id,
    deleted_at: new Date(),
  });

  return success(deleteResult.data);
};

/**
 * Admin disables any user
 */
export const adminDisableUserAny_IO = async ({
  target_id,
  currentUser,
}: {
  target_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<DisableUserResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let userToBeDisabled;
  try {
    userToBeDisabled = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminDisableUserAny_IO', error);
  }
  if (!userToBeDisabled) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // DECISION: the USER_DISABLED audit is gated on the CAS result (disableResult.data !== null), not
  // on a pre-read of disabled_at. Two concurrent disables both pre-read null and both emitted, while
  // the idempotent CAS flipped the state once. Gating on the result emits exactly once.
  const disableResult = await disableUser_IO(userToBeDisabled);
  if (!disableResult.success) {
    return disableResult;
  }

  if (disableResult.data !== null) {
    await emitAdminUserAudit(
      APP_EVENTS.INFO.USER.USER_DISABLED,
      currentUser.id,
      {
        target_id: userToBeDisabled.id,
        disabled_at: new Date(),
      }
    );
  }

  return success(disableResult.data);
};

/**
 * Admin enables any user
 */
export const adminEnableUserAny_IO = async ({
  target_id,
  currentUser,
}: {
  target_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<EnableUserResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let userToBeEnabled;
  try {
    userToBeEnabled = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminEnableUserAny_IO', error);
  }
  if (!userToBeEnabled) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // DECISION: USER_ENABLED is gated on the CAS result, not a pre-read, for the same reason as
  // adminDisableUserAny_IO above (concurrent calls emitted duplicate audits).
  const enableResult = await enableUser_IO(userToBeEnabled);
  if (!enableResult.success) {
    return enableResult;
  }

  if (enableResult.data !== null) {
    await emitAdminUserAudit(
      APP_EVENTS.INFO.USER.USER_ENABLED,
      currentUser.id,
      {
        target_id: userToBeEnabled.id,
        enabled_at: new Date(),
      }
    );
  }

  return success(enableResult.data);
};

/**
 * Admin changes pricing plan for any user
 */
export const adminChangePricingPlan_IO = async ({
  target_id,
  pricing_plan,
  currentUser,
}: {
  target_id: IDType;
  pricing_plan: ADMIN_DTO_API_V1['ADMIN_CHANGE_PRICING_PLAN']['REQUEST']['pricing_plan'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<ChangePricingPlanResponse> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const protectionCheck = await requireTargetNotProtected({
    targetUserId: target_id,
    currentUserId: currentUser.id,
  });
  if (!protectionCheck.success) {
    return protectionCheck;
  }

  let targetUser;
  try {
    targetUser = await getUser_IO({
      props: { id: target_id },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('adminChangePricingPlan_IO', error);
  }
  // DECISION: a soft-deleted target (deleted_at set, recovery pending) is a 404 here. getUser_IO has
  // no state filter, and changing billing must never resurrect or mutate an account awaiting deletion
  // (DOMAIN_SSOT §13.1). Parity with the bulk paths' deleted_at: null.
  if (!targetUser || targetUser.deleted_at !== null) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'USER',
    });
  }

  // DECISION: the admin may set ANY plan, FREE and SCALE included (FREE = comp or downgrade, SCALE =
  // a manually negotiated plan with no self-serve checkout). MASTER_ADMIN-only, so do not narrow it.
  //
  // DECISION: plans apply only to stylist accounts. Both checks are needed: role_id !== STYLIST_ROLE
  // rejects a client who still carries a leftover stylist_account from a role switch (it would be
  // silently raised to PAID), and !stylist_account gives a clear 404 (ACCOUNT) instead of a P2025
  // USER_NOT_FOUND inside setPaymentStateByUserID_IO. Runs after the protection check.
  if (
    targetUser.role_id !== SystemRoleId.STYLIST_ROLE ||
    !targetUser.stylist_account
  ) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: target_id,
      targetType: 'ACCOUNT',
    });
  }

  const oldPlan = targetUser.stylist_account.pricing_plan;

  const paymentResult = await setPaymentStateByUserID_IO({
    id: target_id,
    pricing_plan,
    adminPlanOverride: true,
  });

  if (!paymentResult.success) {
    return paymentResult;
  }

  // DECISION: setPaymentStateByUserID_IO sets PAID, but nothing recomputes account_status for
  // override accounts (the sweep only downgrades and syncAccountWithStripe skips them), so a lapsed
  // EXPIRED stylist raised to PAID stayed invisible. cascadeBulkEnableAccountStatus lifts ACTIVE only
  // for is_active + not deleted + PAID (never unbans), in lockstep with adminBulkChangePlan_IO.
  try {
    await DB_CLIENT.use.$transaction(async tx => {
      await cascadeBulkEnableAccountStatus(tx, [target_id]);
    });
  } catch (error) {
    return databaseFailure('adminChangePricingPlan_IO:reactivate', error);
  }

  // DECISION: setting FREE in the DB does not cancel a live Stripe subscription, which would keep
  // billing. cancelStripeSubscriptionIfExists (reads the sub id, never throws) runs AFTER the write,
  // FREE only (paid to paid goes through Stripe proration); the following subscription.deleted webhook
  // closes the state. reconcileFlavor 'duplicate': the user stays alive, so a 'deletion' row would be
  // closed by the reactivation guard without cancelling (DECISION in cancelStripeSubscriptionIfExists).
  // A crash before this call is caught by the orphan scan (FREE + override still on a live sub).
  if (pricing_plan === PricingPlanValue.FREE) {
    await cancelStripeSubscriptionIfExists(target_id, {
      reconcileFlavor: 'duplicate',
    });
  }

  // DECISION: admin_plan_override protects the pinned plan only from login-time
  // syncAccountWithStripe; the webhook SSOT (updateAccountPlanStatus) writes pricing_plan
  // unconditionally, so a real subscription.updated overrides a manual plan. Intended: admin plan
  // changes target comps on accounts without a sub and downgrades to FREE (sub cancelled above).
  // Pinning over a live paid sub is unsupported; do not add an override gate to the webhook path.

  // OWNER-001: admin_plan_override is set atomically inside
  // setPaymentStateByUserID_IO (the same nested stylist_account.update as
  // pricing_plan and payment_status), so login-time syncAccountWithStripe cannot
  // roll the plan back. It used to be a separate write after setPaymentState.
  // A failure between the payment write and the override left a PAID plan with
  // no flag: a silent revert on the next login, and a confusing 500 to the admin
  // after the plan had already changed.
  try {
    await emitAdminUserAudit(
      APP_EVENTS.INFO.ACCOUNT.PRICING_PLAN_CHANGED,
      currentUser.id,
      {
        target_id,
        old_plan: oldPlan,
        new_plan: pricing_plan,
        changed_by_admin: true,
        admin_plan_override_set: true,
        changed_at: new Date(),
      }
    );
  } catch (error) {
    return databaseFailure('adminChangePricingPlan_IO:audit', error);
  }

  return success(undefined);
};

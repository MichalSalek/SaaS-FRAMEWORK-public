import { DB_CLIENT } from '@app/db/db.client';
import { eraseActorFromNotifications_IO } from '@domain/notifications/operations/notification-write.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';
import type { IDType } from '@kernel/application/application.types';
import { hasCode, narrowUser } from '@kernel/models/type_narrowing';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { userRelationsEnabler } from '@domain/user/user.config';
import { deleteUser_IO } from './user-crud.operations';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { DeleteConfirmInvalidTokenError } from '@kernel/domain/email/email-errors.types';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import { collectStylistAvatarUrlsForUser_IO } from '@domain/account/operations/account-avatar.operations';
import { collectVisitResultPhotoUrlsForUser_IO } from '@domain/visit/operations/visit-result-photo.operations';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isP2025 } from '@app/db/prisma-error';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { verifyDeleteConfirmToken } from '@app/email-handler/email-delete-confirm.token';
import { softDeleteAccount_IO } from './user-soft-delete.operations';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

/**
 * User Mutations (change email, delete self, delete other)
 */

/**
 * Delete self user (user deletes their own account)
 */
export const deleteSelfUser_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<
  OperationResult<UserWithRelations, UserNotFoundError | DatabaseError>
> => {
  let userRaw;
  try {
    userRaw = await DB_CLIENT.use.user.findUnique({
      where: { id },
      include: userRelationsEnabler,
    });
  } catch (error) {
    return databaseFailure('deleteSelfUser_IO', error);
  }

  if (!userRaw) {
    return failure({ type: 'USER_NOT_FOUND', userId: id });
  }

  // Validate user before deletion
  if (!narrowUser<UserWithRelations>(userRaw, 'deleteSelfUser_IO')) {
    reportIssueBackend({
      namespace: 'deleteSelfUser_IO',
      message: 'narrowUser returned null for existing user',
      payload: { id },
      mode: 'error',
    });
    return failure({ type: 'USER_NOT_FOUND', userId: id });
  }

  const userEmail = userRaw.email;

  await cancelStripeSubscriptionIfExists(id);

  // Collect Cloudinary asset URLs before cascade-delete removes records
  let galleryRecords;
  try {
    galleryRecords = await DB_CLIENT.use.galleryRecord.findMany({
      where: { created_by_account: { created_by_user_id: id } },
      select: { asset_url: true },
      take: 5000, // Safety cap — prevent OOM for power-user accounts
    });
  } catch (error) {
    return databaseFailure('deleteSelfUser_IO', error);
  }

  // Also collect VisitResultPhoto assets (karta klientki) — cascade removes them too, blobs would
  // otherwise orphan in Cloudinary. Best-effort (returns [] on error, never blocks delete).
  const visitPhotoUrls = await collectVisitResultPhotoUrlsForUser_IO(id);

  // The stylist's profile photo, a third family of cloud files, now that
  // `avatar_url` has a write path. Without this the face photo survives
  // account deletion.
  const avatarUrls = await collectStylistAvatarUrlsForUser_IO(id);

  // Notifications v2 (Art. 17): the person's name must not survive in OTHER
  // people's notification rows (soft actor reference, no cascade). Best-effort,
  // before the cascade so the actor id is still meaningful.
  await eraseActorFromNotifications_IO(id);

  const deleteResult = await deleteUser_IO({ id });
  if (!deleteResult.success) {
    return failure(deleteResult.error);
  }

  await cleanupNewsletterSubscriberByEmail(userEmail, 'deleteSelfUser_IO', id);

  const assetUrls = [
    ...galleryRecords.map(r => r.asset_url),
    ...visitPhotoUrls,
    ...avatarUrls,
  ];
  if (assetUrls.length > 0) {
    cleanupCloudinaryAssets(assetUrls);
  }

  return success(deleteResult.data);
};

export const cleanupNewsletterSubscriberByEmail = async (
  email: string,
  caller: string,
  subjectUserId: IDType
): Promise<void> => {
  try {
    const result = await DB_CLIENT.use.newsletterSubscriber.deleteMany({
      where: { email },
    });
    if (result.count > 0) {
      reportIssueBackend({
        namespace: 'NEWSLETTER_GDPR_CASCADE',
        message: `Cleaned ${result.count} NewsletterSubscriber row(s) on user delete`,
        payload: { caller, subjectUserId },
        mode: 'info',
      });
    }
  } catch (error) {
    if (hasCode(error) && error.code === 'P2003') {
      try {
        // @unique(email) na NewsletterSubscriber (schema.prisma L871) => co najwyzej
        // 1 wiersz pasuje do { email }. Stad findFirst + pojedynczy update zamiast
        // findMany + petli: brak N+1 (N<=1) i brak ryzyka partial-loop (rzut mid-loop
        // nie moze zostawic kolejnych wierszy nie-zanonimizowanych — bo jest tylko jeden).
        // Anonimizowany email zachowuje sufiks row.id => pozostaje unikalny (kolizja @unique
        // wykluczona przy wielu kasacjach).
        const row = await DB_CLIENT.use.newsletterSubscriber.findFirst({
          where: { email },
          select: { id: true },
        });
        if (row) {
          await DB_CLIENT.use.newsletterSubscriber.update({
            where: { id: row.id },
            data: {
              email: `anonymized-${row.id}@deleted.invalid`,
              ip_address: null,
              consent_source: null,
              consent_timestamp: null,
              confirmation_token: null,
              is_active: false,
            },
          });
        }
        reportIssueBackend({
          namespace: 'NEWSLETTER_GDPR_CASCADE',
          message: `Anonymized ${row ? 1 : 0} confirmed NewsletterSubscriber row(s) on user delete (consent-audit preserved)`,
          payload: { caller, subjectUserId },
          mode: 'info',
        });
      } catch (anonError) {
        reportIssueBackend({
          namespace: 'NEWSLETTER_GDPR_CASCADE_FAILED',
          message:
            'Failed to anonymize NewsletterSubscriber on user delete — manual GDPR follow-up required',
          payload: { caller, subjectUserId, error: anonError },
          mode: 'error',
        });
      }
      return;
    }
    reportIssueBackend({
      namespace: 'NEWSLETTER_GDPR_CASCADE_FAILED',
      message:
        'Failed to cleanup NewsletterSubscriber on user delete — manual GDPR follow-up required',
      payload: { caller, subjectUserId, error },
      mode: 'error',
    });
  }
};

/**
 * Confirm delete self user via HMAC token from email.
 * Soft-deletes: is_active=false, sessions cleared, Stripe cancelled.
 * User has 90 days to recover via login.
 */
export const confirmDeleteSelf_IO = async ({
  token,
}: {
  token: string;
}): Promise<
  OperationResult<
    {
      confirmed: boolean;
      userId: string;
      /**
       * true ONLY when THIS call performed the soft-delete. Replays (account already
       * inactive, token already consumed, lost CAS race) are idempotent success with
       * applied=false: the client sees the same `{ confirmed: true }`, but the caller
       * must not write a USER_DELETE_CONFIRMED audit row for a deletion that did not
       * happen here (one row per logical deletion, parity with ACCOUNT_SOFT_DELETED).
       */
      applied: boolean;
    },
    DeleteConfirmInvalidTokenError | UserNotFoundError | DatabaseError
  >
> => {
  const decoded = verifyDeleteConfirmToken(token);
  if (!decoded) {
    return failure({ type: 'DELETE_CONFIRM_INVALID_TOKEN' });
  }

  let userRaw;
  try {
    userRaw = await DB_CLIENT.use.user.findUnique({
      where: { id: decoded.userId },
      include: userRelationsEnabler,
    });
  } catch (error) {
    return databaseFailure('confirmDeleteSelf_IO', error);
  }

  if (!userRaw) {
    return failure({ type: 'USER_NOT_FOUND', userId: decoded.userId });
  }

  const user = narrowUser<UserWithRelations>(userRaw, 'confirmDeleteSelf_IO');
  if (!user) {
    reportIssueBackend({
      namespace: 'confirmDeleteSelf_IO',
      message: 'narrowUser returned null for existing user',
      payload: { id: decoded.userId },
      mode: 'error',
    });
    return failure({ type: 'USER_NOT_FOUND', userId: decoded.userId });
  }

  // DECISION: single use plus a state precondition on the delete-confirm token. The HMAC token is
  // stateless (no nonce store) and the endpoint is unauthenticated (AUTHENTICATION_CHECK_ENABLED=false),
  // so account-state-guard never runs here; the state precondition is enforced HERE and atomically in
  // softDeleteAccount_IO (updateMany WHERE is_active=true). A replay of a valid token on an account that
  // is no longer ACTIVE (recoverable, expired, admin-disabled) is an idempotent success-noop: no re-kill,
  // no reset of deleted_at, no re-armed recovery_available, no second recovery e-mail.
  if (!user.is_active) {
    return success({ confirmed: true, userId: user.id, applied: false });
  }

  // DECISION: true single use via a per-user epoch. The state precondition alone is not enough: after a
  // legit reactivation the account is ACTIVE again, so replaying an old (up to 24h) token would kill it
  // again. The token carries delete_confirm_version from mint time and an atomic compare-and-increment
  // runs here: updateMany WHERE id AND is_active=true AND delete_confirm_version = <token's> => version++.
  // count 1 = claim won, token consumed, continue; count 0 = token used or stale (a prior confirm or
  // reactivateAccount_IO bumped the version) or the account is no longer ACTIVE (lost a parallel confirm)
  // => idempotent success-noop, no re-kill, no mail. The compare-and-increment is the serialization
  // point: of parallel confirms with one token only one bumps the version.
  let consume;
  try {
    consume = await DB_CLIENT.use.user.updateMany({
      where: {
        id: user.id,
        is_active: true,
        delete_confirm_version: decoded.version,
      },
      data: { delete_confirm_version: { increment: 1 } },
    });
  } catch (error) {
    return databaseFailure('confirmDeleteSelf_IO', error);
  }
  if (consume.count === 0) {
    return success({ confirmed: true, userId: user.id, applied: false });
  }

  await cancelStripeSubscriptionIfExists(decoded.userId);

  // ADRR Model A: soft-delete (NOT admin-ban). is_active=false, deleted_at=now(),
  // recovery_available=true, sessions cleared. Data stays in-place for reactivation.
  // Atomic compare-and-set inside: null => account was not ACTIVE (lost the race or
  // already inactive) => idempotent no-op, do NOT re-arm / re-notify.
  const softDeleteResult = await softDeleteAccount_IO(user);
  if (!softDeleteResult.success) {
    return softDeleteResult;
  }
  if (softDeleteResult.data === null) {
    return success({ confirmed: true, userId: user.id, applied: false });
  }

  // DECISION: ACCOUNT_SOFT_DELETED is a LIFECYCLE event (shown in the user's "Aktywności") and is recorded
  // HERE, on the DB mutation's success, independent of the recovery e-mail. Its only write site used to be
  // the infoEvent passed to sendTransactionalEmail, which audits only when the mail is sent, so a send
  // failure left a soft-deleted account without an audit row. One row per success (the version claim above
  // admits one entry per token); the e-mail carries its own fact EMAIL_ACCOUNT_DELETION_RECOVERY_SENT and
  // the endpoint writes USER_DELETE_CONFIRMED separately. Best-effort: recordAuditEvent_IO never throws,
  // so it cannot undo the soft-delete.
  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.USER.ACCOUNT_SOFT_DELETED,
    user: { id: user.id },
    responseBody: { confirmed: true },
  });

  // DECISION: the "account deleted, 90 days to restore" e-mail is AWAITED (the only notice of the
  // recovery window and the way back), but a send failure must NOT fail the soft-delete: the account IS
  // already soft-deleted, a missing mail is degraded UX, not data integrity. On failure log the error
  // (dead-letter inside sendTransactionalEmail) and continue. infoEvent is INFO.EMAIL.* (the "email-sent"
  // fact), not ACCOUNT_SOFT_DELETED, which would couple the lifecycle row to the mail's fate.
  const loginUrl = `${buildFrontendBaseUrl()}${ROUTES_FRONT.USER_LOG}`;
  const emailSent = await sendTransactionalEmail(
    'account-deleted-recovery',
    { email: user.email, name: user.name, id: user.id },
    APP_EVENTS.INFO.EMAIL.EMAIL_ACCOUNT_DELETION_RECOVERY_SENT,
    { loginUrl },
    'email.accountDeletedRecovery.subject'
  );
  if (!emailSent) {
    reportIssueBackend({
      namespace: 'confirmDeleteSelf_IO',
      message:
        'Soft-delete recovery email failed to send — account is soft-deleted, user lacks recovery notice (manual follow-up)',
      payload: { userId: user.id },
      mode: 'error',
    });
  }

  // DECISION: return userId so the endpoint can pass it to recordAuditEvent_IO (meta.created_by_user_id).
  // The endpoint has no session (token-based confirmation, AUTHENTICATION_CHECK_ENABLED=false), so without
  // it writeRawEventLog_IO rejects the event with "missing meta.created_by_user_id" on every confirm.
  return success({ confirmed: true, userId: user.id, applied: true });
};

/**
 * Update notification preferences for a user.
 *
 * DECISION: the stored flag controls ACTIVITY emails (new message, pairing request, client connected by
 * QR, shared session); see application/email-handler/activity-email-consent.ts. (owner)
 */
export const updateNotificationPreferences_IO = async ({
  user_id,
  notifications_enabled,
}: {
  user_id: IDType;
  notifications_enabled: boolean;
}): Promise<
  OperationResult<
    USER_DTO_API_V1['USER_UPDATE_NOTIFICATION_PREFERENCES']['RESPONSE'],
    UserNotFoundError | DatabaseError
  >
> => {
  try {
    const updated = await DB_CLIENT.use.user.update({
      where: { id: user_id },
      data: { notifications_enabled },
      select: { notifications_enabled: true },
    });

    return success({ notifications_enabled: updated.notifications_enabled });
  } catch (error) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: user_id });
    }
    return databaseFailure('updateNotificationPreferences_IO', error);
  }
};

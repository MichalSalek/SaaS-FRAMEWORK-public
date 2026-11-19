import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Whether a user accepts ACTIVITY emails: new message, pairing request, a
 * client connected by QR, a shared inspiration session.
 *
 * DECISION: the account switch „Powiadomienia o aktywności” and the onboarding one
 * „Powiadomienia e-mail” (`users.notifications_enabled`, default true) control exactly these
 * mails. Transactional mail (login link, email change, payments, account deletion, support
 * replies) and lifecycle sequences with their own preferences ignore this flag. Fail closed:
 * when the consent cannot be read the mail is skipped (best-effort anyway, and an unverified
 * consent is not one). A soft-deleted or deactivated account gets no activity mail either:
 * pairs and shared sessions survive soft-delete, but the owner cannot act until a restore.
 * (owner) Since notifications v2 (2026-10-19) the same switch gates PUSH
 * delivery (domain/notifications/push/push-dispatch.service.ts); the in-app rows of the
 * notification centre do not depend on it.
 */
export const ACTIVITY_CONSENT_SELECT = {
  notifications_enabled: true,
  is_active: true,
  deleted_at: true,
} as const;

export type ActivityConsentFields = {
  notifications_enabled: boolean;
  is_active: boolean;
  deleted_at: Date | null;
};

/** Pure predicate over a row read with ACTIVITY_CONSENT_SELECT. */
export const acceptsActivityEmail = (
  user: ActivityConsentFields | null | undefined
): boolean =>
  user != null &&
  user.is_active &&
  user.deleted_at === null &&
  user.notifications_enabled;

export const activityEmailsAllowed_IO = async (
  userId: string
): Promise<boolean> => {
  try {
    const user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: ACTIVITY_CONSENT_SELECT,
    });
    return acceptsActivityEmail(user);
  } catch (error: unknown) {
    reportIssueBackend({
      namespace: 'activityEmailsAllowed',
      message: 'Could not read notifications_enabled; activity email skipped',
      payload: { userId, error: String(error) },
      mode: 'warn',
    });
    return false;
  }
};

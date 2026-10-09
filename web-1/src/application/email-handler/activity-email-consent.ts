import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Whether a user accepts ACTIVITY emails: new message, pairing request, a
 * client connected by QR, a shared inspiration session.
 *
 * DECISION (nie usuwaj tego komentarza), owner 2026-09-25: the account switch
 * „Powiadomienia o aktywności” and the onboarding one „Powiadomienia e-mail”
 * (`users.notifications_enabled`, default true) control exactly these mails. Transactional mail (login link,
 * email change, payments, account deletion, support replies) and the
 * lifecycle sequences with their own preferences are NOT activity mail and
 * ignore this flag. Fail closed: when the consent cannot be read the mail is
 * skipped (it is best-effort anyway, and an unverified consent is not one).
 * A soft-deleted or deactivated account gets no activity mail either (S82,
 * first applied to messaging): pairs and shared sessions survive soft-delete
 * by design, but the owner cannot act on the notice until a restore.
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

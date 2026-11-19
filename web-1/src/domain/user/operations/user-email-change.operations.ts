import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { updateStripeCustomerEmail } from '@app/stripe/customer.operations';
import type { IDType } from '@kernel/application/application.types';
import type { User } from '@kernel/models/db_models.generated.dto';
import { hasCode, narrowUser } from '@kernel/models/type_narrowing';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  UserNotFoundError,
  UserEmailAlreadyInUseError,
} from '@kernel/domain/user-and-account/user-errors.types';
import type {
  DatabaseError,
  ExternalServiceError,
} from '@kernel/application/common-errors.types';
import type { EmailChangeInvalidTokenError } from '@kernel/domain/email/email-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isP2025 } from '@app/db/prisma-error';
import {
  createEmailChangeToken,
  verifyEmailChangeToken,
} from '@app/email-handler/email-change.token';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { resolveLocaleByEmail } from '@app/email-handler/email-locale.resolver';
import { runEmailRequestOnce } from '@app/email-handler/email-request-dedup';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';

export const changeUserEmail_IO = async ({
  id,
  new_email,
  current_email,
  user_name,
}: {
  id: IDType;
  new_email: string;
  current_email: string;
  user_name: string | null;
}): Promise<
  OperationResult<
    { message: string },
    UserNotFoundError | DatabaseError | ExternalServiceError
  >
> => {
  const normalizedEmail =
    VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(new_email);

  // DECISION: anti-enumeration. The request-side duplicate check MUST answer indistinguishably from a free
  // address, else a logged-in user probing e-mails learns which are registered (400 vs 200). Same posture
  // as check-recovery, newsletter ALREADY_SUBSCRIBED and magic-link. For a taken address return the SAME
  // neutral success as the happy path ({ message: 'VERIFICATION_EMAIL_SENT' }) and send NO mail (a confirm
  // to someone else's address is spam/leak; an error restores the oracle). The confirm side
  // (confirmEmailChange_IO) may still return USER_EMAIL_ALREADY_IN_USE on P2002 (a TOCTOU between request
  // and click): not an oracle, since an attacker does not control the target mailbox.
  try {
    const existingUser = await DB_CLIENT.use.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });

    if (existingUser) {
      return success({ message: 'VERIFICATION_EMAIL_SENT' });
    }
  } catch (error) {
    return databaseFailure('changeUserEmail_IO:checkDuplicate', error);
  }

  // Bind the CURRENT email (at request time) into the token alongside the new
  // one. confirmEmailChange_IO requires the DB email to still equal this value,
  // making the token single-use + monotonic without a schema column (findings
  // user-account-1 replay / user-account-2 stale-revert). Normalize identically
  // to how emails are stored (lowercase + whitespace-stripped) so the confirm-side
  // WHERE email = currentEmail guard matches the canonical stored form.
  const normalizedCurrentEmail =
    VALIDATION_POLICY.utils.normalizeStringEliminateWhitespaces(current_email);
  const token = createEmailChangeToken(
    id,
    normalizedCurrentEmail,
    normalizedEmail
  );

  const confirmUrl = `${buildFrontendBaseUrl()}/api/v1/user/confirm-email-change?token=${encodeURIComponent(token)}`;

  // Locale: resolve ONCE by the CURRENT (old) address — that is the user's
  // identity in the DB. The confirm email goes to the NEW address, which has no
  // user row yet, so the default by-recipient resolution inside
  // sendTransactionalEmail would always fail-open to 'pl'. Both emails address
  // the same person, so both reuse this resolved locale (fail-open to 'pl').
  const userLocale = await resolveLocaleByEmail(normalizedCurrentEmail);

  // A repeat of the same request (same user, same current and new address) within the
  // dedup window = the same neutral success without a second pair of mails. See the
  // DECISION in email-request-dedup.ts (window, „wyślij ponownie", multiple instances).
  const dedupKey = `email-change:${id}:${normalizedCurrentEmail}:${normalizedEmail}`;
  // DECISION: infoEvent must be the "email-sent" fact (INFO.EMAIL.*), not the lifecycle event
  // USER_EMAIL_CHANGE_REQUESTED. sendTransactionalEmail writes an audit row per successful send using the
  // PASSED infoEvent, and the single lifecycle row is written only by the handler (change-email/index.ts,
  // runAfterResponse). The two mails (confirm to the new address, security notify to the old) are separate
  // auditable facts; passing USER.* here tripled the lifecycle row.
  const confirm = await runEmailRequestOnce(dedupKey, () =>
    sendTransactionalEmail(
      'email-change-confirm',
      { email: normalizedEmail, name: user_name, id },
      APP_EVENTS.INFO.EMAIL.EMAIL_CHANGE_CONFIRM_SENT,
      { confirmUrl },
      'email.changeEmail.confirm.subject',
      userLocale
    )
  );
  const confirmSent = confirm.sent;
  if (!confirmSent) {
    // One failure = one report: a joined duplicate shares the first request's.
    if (!confirm.joined) {
      reportIssueBackend({
        namespace: 'CRITICAL_EMAIL_FAILED',
        message: `Email change confirmation failed for user ${id}`,
        payload: { userId: id, newEmail: normalizedEmail },
        mode: 'error',
      });
    }
    return failure({
      type: 'EXTERNAL_SERVICE_ERROR',
      service: 'MAILGUN',
      operation: 'sendEmailChangeConfirm',
    });
  }

  // A joined duplicate stops here: the first request sends the notification.
  if (confirm.joined) {
    return success({ message: 'VERIFICATION_EMAIL_SENT' });
  }

  // Security notification to current email — failure is logged but does not
  // block the primary flow. Confirmation has already been delivered above.
  const notifySent = await sendTransactionalEmail(
    'email-change-notify',
    { email: current_email, name: user_name, id },
    APP_EVENTS.INFO.EMAIL.EMAIL_CHANGE_NOTIFY_SENT,
    { newEmail: normalizedEmail },
    'email.changeEmail.notify.subject',
    userLocale
  );
  if (!notifySent) {
    reportIssueBackend({
      namespace: 'EMAIL_CHANGE_NOTIFY_FAILED',
      message: 'Failed to send email-change notification to current email',
      payload: { userId: id, current_email },
      mode: 'error',
    });
  }

  return success({ message: 'VERIFICATION_EMAIL_SENT' });
};

export const confirmEmailChange_IO = async ({
  token,
}: {
  token: string;
}): Promise<
  OperationResult<
    { confirmed: boolean; userId: string },
    | EmailChangeInvalidTokenError
    | UserNotFoundError
    | UserEmailAlreadyInUseError
    | DatabaseError
  >
> => {
  const decoded = verifyEmailChangeToken(token);
  if (!decoded) {
    return failure({ type: 'EMAIL_CHANGE_INVALID_TOKEN' });
  }

  // DECISION: atomic compare-and-set (updateMany WHERE), not an unconditional user.update. The WHERE
  // encodes the preconditions: (1) account state is_active=true, deleted_at=null, disabled_at=null (a
  // disabled, banned or soft-deleted account cannot change its e-mail); (2) single-use/stale nonce: the
  // e-mail must still equal decoded.currentEmail (the address at request time, baked into the token), so
  // after the first confirm every replay or stale link hits count=0. sessions.deleteMany runs in the SAME
  // transaction and only when count===1 (a real change), so a replay no longer forces a logout.
  // updateMany has no nested relation writes, hence the separate step in the $transaction.
  const stateGuard = {
    is_active: true,
    deleted_at: null,
    disabled_at: null,
  } as const;
  const nonceGuard = { email: decoded.currentEmail };

  let outcome:
    | { ok: true; user: User }
    | { ok: false; reason: 'INVALID_TOKEN' | 'NOT_FOUND' };
  try {
    outcome = await DB_CLIENT.use.$transaction(async tx => {
      const claim = await tx.user.updateMany({
        where: { id: decoded.userId, ...stateGuard, ...nonceGuard },
        data: {
          email: decoded.newEmail,
          emailVerified: true,
        },
      });

      if (claim.count === 0) {
        // Classify the no-op: not-found vs not-mutable/stale. Read-only, runs
        // only on the (rare) failure path. Disabled/banned/soft-deleted maps to
        // INVALID_TOKEN — the token is not honorable for this account, and we do
        // NOT surface account state to an unauthenticated caller (no enumeration).
        const probe = await tx.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true },
        });
        return {
          ok: false as const,
          reason: probe ? ('INVALID_TOKEN' as const) : ('NOT_FOUND' as const),
        };
      }

      // Real change applied → purge sessions (forced re-login). Conditional on
      // count===1, so a replayed/stale token never re-runs this.
      await tx.session.deleteMany({ where: { userId: decoded.userId } });

      const fresh = await tx.user.findUnique({ where: { id: decoded.userId } });
      const narrowedFresh = fresh
        ? narrowUser<User>(fresh, 'confirmEmailChange_IO:fresh')
        : null;
      if (!narrowedFresh) {
        reportIssueBackend({
          namespace: 'confirmEmailChange_IO',
          message: 'narrowUser returned null after successful update',
          payload: { id: decoded.userId },
          mode: 'error',
        });
        return { ok: false as const, reason: 'NOT_FOUND' as const };
      }
      return { ok: true as const, user: narrowedFresh };
    });
  } catch (error: unknown) {
    const code = hasCode(error) ? error.code : undefined;
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: decoded.userId });
    }
    if (code === 'P2002') {
      return failure({
        type: 'USER_EMAIL_ALREADY_IN_USE',
        email: decoded.newEmail,
      });
    }
    return databaseFailure('confirmEmailChange_IO', error);
  }

  if (!outcome.ok) {
    if (outcome.reason === 'NOT_FOUND') {
      return failure({ type: 'USER_NOT_FOUND', userId: decoded.userId });
    }
    // Stale / replayed / not-in-mutable-state token. 4xx, NO session purge ran.
    return failure({ type: 'EMAIL_CHANGE_INVALID_TOKEN' });
  }
  const updatedUser: User = outcome.user;

  // Stripe email sync (best-effort; runs only after the email actually changed).
  // The email flip + session purge already committed in the transaction above,
  // so a read failure here must NOT roll the change back — log and continue.
  try {
    const userWithAccount = await DB_CLIENT.use.user.findUnique({
      where: { id: decoded.userId },
      select: { stylist_account: { select: { stripe_customer_id: true } } },
    });

    if (userWithAccount?.stylist_account?.stripe_customer_id) {
      const stripeCustomerId =
        userWithAccount.stylist_account.stripe_customer_id;
      try {
        await updateStripeCustomerEmail({
          stripeCustomerId,
          newEmail: decoded.newEmail,
        });
      } catch (err) {
        reportIssueBackend({
          namespace: 'updateStripeCustomerEmail_FAILED',
          message:
            'Stripe customer email sync failed — billing receipts may go to old email',
          payload: {
            stripeCustomerId,
            newEmail: decoded.newEmail,
            error: err instanceof Error ? err.message : String(err),
          },
          mode: 'error',
        });
        runAfterResponse(() =>
          recordAuditEvent_IO({
            eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_EMAIL_SYNC_FAILED,
            user: { id: decoded.userId },
            responseBody: {
              stripeCustomerId,
              newEmail: decoded.newEmail,
            },
          })
        );
      }
    }
  } catch (err) {
    reportIssueBackend({
      namespace: 'confirmEmailChange_IO:stripeLookup',
      message:
        'Post-change Stripe customer lookup failed — email change already applied',
      payload: {
        userId: decoded.userId,
        error: err instanceof Error ? err.message : String(err),
      },
      mode: 'error',
    });
  }

  void reportIssueBackend({
    namespace: 'confirmEmailChange_IO',
    message: `Email changed for user ${updatedUser.id}`,
    payload: { userId: updatedUser.id, newEmail: updatedUser.email },
    mode: 'info',
  });

  // DECISION: return userId so the endpoint can pass it to recordAuditEvent_IO (meta.created_by_user_id).
  // The endpoint has no session (token-based confirmation, AUTHENTICATION_CHECK_ENABLED=false), so without
  // it writeRawEventLog_IO logs "missing created_by_user_id" and writes no audit row on every confirm.
  return success({ confirmed: true, userId: updatedUser.id });
};

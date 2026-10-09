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

  // DECISION (nie usuwaj tego komentarza):
  // ANTI-ENUMERATION (finding user-account-lifecycle-2). Request-side duplicate
  // check MUSI dać odpowiedź NIEROZRÓŻNIALNĄ od wolnego adresu — inaczej zalogowany
  // user sondując dowolne emaile uczy się, które są zarejestrowane (oracle 400 vs 200).
  // To pogwałcenie spójnej anty-enumeracyjnej postawy projektu: check-recovery zwraca
  // uniform 200 per-email (recovery.operations §13.1), newsletter ALREADY_SUBSCRIBED →
  // respondSuccess (error-mapper.ts), magic-link/Better-Auth → constant-time + 200.
  // FIX root-cause: gdy email zajęty → zwróć TEN SAM neutral success co happy-path
  //   ({ message: 'VERIFICATION_EMAIL_SENT' }) i NIE wysyłaj żadnego maila.
  //   - NIE wolno wysłać confirm na zajęty (cudzy) adres — to spam/leak do właściciela.
  //   - NIE wolno zwrócić błędu — to przywraca oracle.
  // Confirm-side (confirmEmailChange_IO) NADAL może zwrócić USER_EMAIL_ALREADY_IN_USE
  // na P2002 (TOCTOU race między żądaniem a kliknięciem linku) — to NIE oracle: atakujący
  // nie kontroluje skrzynki docelowej, więc nigdy nie kliknie linku ani nie zobaczy 400.
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

  // Powtórka tego samego żądania (ten sam user, ten sam obecny i nowy adres) w
  // oknie dedupu = ten sam neutralny sukces bez drugiej pary maili. DECISION w
  // email-request-dedup.ts (okno, „wyślij ponownie", wiele instancji).
  const dedupKey = `email-change:${id}:${normalizedCurrentEmail}:${normalizedEmail}`;
  // DECISION (nie usuwaj tego komentarza):
  // AUDIT INTEGRITY (finding F-EMAIL-AUDIT). sendTransactionalEmail zapisuje audit-row
  // per udany send, używając PRZEKAZANEGO infoEvent (email-transactional.ts:204). Dlatego
  // infoEvent MUSI być właściwym faktem "email-sent" (INFO.EMAIL.*), a NIE zdarzeniem
  // lifecycle USER_EMAIL_CHANGE_REQUESTED. Pojedynczy wiersz lifecycle pisze WYŁĄCZNIE
  // handler (change-email/index.ts, runAfterResponse) — dokładnie raz. Te dwa maile to
  // dwa ODRĘBNE, osobno-audytowalne fakty: confirm-do-nowego vs security-notify-do-starego.
  // Przekazanie tu USER.* dublowało wiersz lifecycle ×2 (razem 3 identyczne rows/żądanie).
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

  // DECISION (nie usuwaj tego komentarza):
  // Atomowy compare-and-set (updateMany WHERE), NIE bezwarunkowy user.update.
  // WHERE koduje TRZY precondycje (zamykają user-account-1/2/5 jednym guardem):
  //   1. account-state: is_active=true AND deleted_at=null AND disabled_at=null
  //      → disabled/admin-ban/soft-deleted konto jest NIEMUTOWALNE dla zmiany
  //        emaila (user-account-5; mirror reactivateAccount_IO / account-state-guard).
  //   2. single-use/stale nonce: email MUSI nadal === decoded.currentEmail
  //      (email z chwili żądania, wbity w token). Po pierwszym confirm email się
  //      zmienia → każdy replay/stale link trafia count=0 (user-account-1 replay,
  //      user-account-2 ghost-revert).
  // sessions.deleteMany przeniesione DO TEJ SAMEJ transakcji i odpalane TYLKO gdy
  // count===1 (realna zmiana) — koniec z bezwarunkowym forced-logout przy replayu
  // (user-account-1b). updateMany nie wspiera nested relation writes → osobny krok
  // w $transaction (jak reactivateAccount_IO).
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

  // DECISION (nie usuwaj tego komentarza):
  // Zwracamy userId aby endpoint mógł przekazać go do recordAuditEvent_IO
  // (meta.created_by_user_id). Endpoint nie ma sesji (token-based confirmation,
  // AUTHENTICATION_CHECK_ENABLED=false) — userId musi przyjść z operation, inaczej
  // writeRawEventLog_IO loguje "missing created_by_user_id" w trybie error i NIE
  // tworzy audit row. Każde kliknięcie linku confirm = false-positive error log.
  return success({ confirmed: true, userId: updatedUser.id });
};

import { DB_CLIENT } from '@app/db/db.client';
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

  // Cancel Stripe subscription before deletion (best-effort, non-blocking).
  // Cancel best-effort; failure logged high-visibility inside
  // cancelStripeSubscriptionIfExists (reportIssueBackend error + dispatchCriticalAlert
  // → operator cancels manually). MUST NOT block GDPR/self hard-delete on Stripe outage.
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

  // Zdjęcie profilowe stylistki — trzecia rodzina plików w chmurze (2026-09-09,
  // odkąd `avatar_url` ma ścieżkę zapisu). Bez tego zdjęcie twarzy przeżywa
  // usunięcie konta.
  const avatarUrls = await collectStylistAvatarUrlsForUser_IO(id);

  const deleteResult = await deleteUser_IO({ id });
  if (!deleteResult.success) {
    return failure(deleteResult.error);
  }

  // GDPR Art. 17 — cascade NewsletterSubscriber by email (no FK to User).
  // Independent of user FK so cleanup must happen explicitly post-delete.
  await cleanupNewsletterSubscriberByEmail(userEmail, 'deleteSelfUser_IO', id);

  // Fire-and-forget: cleanup Cloudinary assets (GDPR Art. 17) — gallery + visit-result photos.
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

// DECISION (nie usuwaj tego komentarza):
// Eksportowany (nie const-private), bo wpinają go OBIE ścieżki hard-delete usera —
// self (deleteSelfUser_IO, wołane przez /gdpr-erase) ORAZ admin hard-delete
// (adminDeleteUserAny_IO w admin-user-management.operations.ts). NewsletterSubscriber
// jest email-keyed i NIE ma FK do User, więc cascade po User-FK go nie dosięga → każda
// ścieżka hard-delete musi posprzątać go jawnie (GDPR Art.17 parity). Eksport zamiast
// przeniesienia do deleteUser_IO: cleanup jest opcjonalny per-caller i email-zależny,
// a import admin→user-mutations jest cycle-free (user-mutations ciągnie tylko
// application/*, @kernel/*, user-crud, gallery — żadnego importu z domeny admin).
// DECISION (nie usuwaj tego komentarza) — W LOGACH `subjectUserId`, NIGDY `email`:
// wszystkie cztery wpisy NEWSLETTER_GDPR_CASCADE niosły w payloadzie adres e-mail
// usuwanego usera, a ten z gałęzi `mode:'error'` leci BEZWARUNKOWO (błąd omija bramkę
// debug-mode i throttling loggera). Event Log ma retencję 90 dni i NIE redaguje klucza
// `email` (SENSITIVE_KEY_REGEX w error-handler.ts obejmuje tylko sekrety), więc adres
// przeżywał w log-storze usunięcie konta, które ten wpis dokumentuje — czyli erasure
// zostawiała po sobie własną kopię danych. `subjectUserId` daje tę samą korelację
// (ten sam identyfikator nosi cała reszta śladu tego usera), a po hard-delete nie
// rozwiązuje się już do żadnej osoby.
// GRANICA: reguła dotyczy wyłącznie Event Logu. Archiwum `DeletedUser.body` to osobny
// magazyn z własnym kontraktem (userRelationsArchiveEnabler); Event Log to kanał
// diagnostyczny, nie archiwum. Nie „przywracać" e-maila w logach przez analogię
// do archiwum.
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
    // DECISION (nie usuwaj tego komentarza) — OSOBNY REŻIM: newsletter-consent ≠ dane konta.
    // Dane konta (konto, karta klientki) idą do DeletedUser.body. Zgoda
    // marketingowa (NewsletterSubscriber) to INNY reżim (Art.30 consent-audit): przy usunięciu konta
    // user pozbywa się subskrypcji, więc jej PII ma ZNIKNĄĆ (scrub). Newsletter nie jest
    // częścią archiwum konta.
    // GDPR Art.17 completeness (finding
    // gdpr-cascade-exhaustive-1): CONFIRMED subskrybent ma >=1 NewsletterConsentEvent, ktorego
    // FK do NewsletterSubscriber jest onDelete: Restrict (celowy append-only consent-audit —
    // schema softdelete-gdpr-cascade-4). deleteMany rzuca wtedy P2003 i PII wiersza (email,
    // ip_address, consent_source, consent_timestamp) przezylaby erasure usera. Fix:
    // ANONIMIZACJA-IN-PLACE zamiast delete — nieodwracalny scrub PII przy zachowaniu wiersza+id,
    // wiec consent-event FK zostaje wazny. To sciezka ktora nazywa schema DECISION; spelnia
    // Art.17 (PII znika) bez niszczenia sladu zgody Art.30.
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

  // DECISION (nie usuwaj tego komentarza):
  // Single-use + state-precondition na delete-confirm tokenie (QA user-lifecycle-1/2).
  // Token HMAC jest bezstanowy (brak nonce/consumed-store) i endpoint jest
  // nieuwierzytelniony (AUTHENTICATION_CHECK_ENABLED=false), więc account-state-guard
  // nigdy nie odpala na tej ścieżce. Precondition stanu egzekwujemy TUTAJ + atomowo
  // w softDeleteAccount_IO (updateMany WHERE is_active=true). Replay waznego tokenu na
  // koncie, ktore JUZ nie jest ACTIVE (RECOVERABLE/EXPIRED/ADMIN-DISABLED) =>
  // idempotentny success-noop: NIE re-killujemy, NIE resetujemy deleted_at, NIE
  // re-armujemy recovery_available, NIE wysyłamy ponownie recovery-emaila. To zamyka
  // replay-loop (kill -> reactivate -> kill) i resurekcję wygasłego okna recovery.
  if (!user.is_active) {
    return success({ confirmed: true, userId: user.id, applied: false });
  }

  // DECISION (nie usuwaj tego komentarza):
  // Prawdziwy single-use via per-user epoch (QA user-lifecycle-1 signal #2:
  // reactivationUndoneByReplay). Sam state-precondition NIE wystarcza — po LEGIT
  // reaktywacji konto znów jest ACTIVE, więc replay starego (≤24h) tokenu znowu by je
  // zabił. Token niesie w payloadzie wartość delete_confirm_version z chwili mintu.
  // TUTAJ robimy ATOMOWY compare-and-increment: updateMany WHERE id AND is_active=true
  // AND delete_confirm_version = <z tokenu> => delete_confirm_version++.
  //  • count === 1 → wygraliśmy claim, wersja zużyta (token staje się jednorazowy),
  //    konto wciąż ACTIVE → kontynuujemy soft-delete.
  //  • count === 0 → token zużyty/stały (wersja nie zgadza się, bo wcześniejszy confirm
  //    lub reactivateAccount_IO już ją podbiły) ALBO konto nie jest już ACTIVE
  //    (przegrany wyścig równoległego confirma) → idempotentny success-noop. NIE
  //    re-killujemy, NIE wysyłamy maila. To eliminuje replay-after-reactivate.
  // Compare-and-increment JEST punktem serializacji: równoległe confirmy z tym samym
  // tokenem — tylko jeden podbije wersję (count=1), reszta trafi w mismatch (count=0).
  // Po wygranym claimie konto pozostaje ACTIVE (reactivate wymaga recovery_available=true),
  // więc kolejny atomowy CAS w softDeleteAccount_IO (WHERE is_active=true) dopnie przejście.
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

  // DECISION (nie usuwaj tego komentarza):
  // AUDIT INTEGRITY (finding F-SOFTDELETE-AUDIT, ta sama klasa co F-EMAIL-AUDIT w
  // user-email-change.operations.ts). ACCOUNT_SOFT_DELETED to zdarzenie LIFECYCLE (widoczne
  // na user-facing „Aktywności") i MUSI być zapisane na SUKCESIE mutacji DB — niezależnie od
  // losu recovery-emaila. Wcześniej jego JEDYNYM write-site był infoEvent przekazany do
  // sendTransactionalEmail, a recordAuditEvent_IO tam odpala tylko gdy mail się wyśle → przy
  // awarii wysyłki konto było soft-deleted, ale wiersz audytu NIE powstawał (happy path go
  // pokazywał, failure path gubił). Dedykowany call TUTAJ = dokładnie JEDEN wiersz na sukces
  // (mint wersji w compare-and-increment powyżej gwarantuje pojedyncze wejście w tę ścieżkę na
  // token), a recovery-email niesie własny, odrębny fakt EMAIL_ACCOUNT_DELETION_RECOVERY_SENT.
  // Endpoint (delete/confirm) pisze osobno USER_DELETE_CONFIRMED (runAfterResponse) — inny fakt.
  // Best-effort: recordAuditEvent_IO nigdy nie rzuca (try/catch wewnątrz), więc nie może cofnąć
  // soft-delete; audit-miss loguje się high-visibility w środku wrappera.
  await recordAuditEvent_IO({
    eventName: APP_EVENTS.INFO.USER.ACCOUNT_SOFT_DELETED,
    user: { id: user.id },
    responseBody: { confirmed: true },
  });

  // DECISION (nie usuwaj tego komentarza):
  // Email "Konto usunięte — masz 90 dni na przywrócenie" wysyłany AWAIT (krytyczny —
  // to jedyna notyfikacja o oknie recovery + ścieżce powrotu). Wzorzec await mirror
  // email-change/delete-confirm. ALE soft-delete NIE może hard-failować na błędzie
  // emaila: konto JEST już soft-deleted (sukces operacji DB), a brak emaila to degraded
  // UX, nie data-integrity failure. Failure → log error (dead-letter handled wewnątrz
  // sendTransactionalEmail), kontynuuj sukces. Link do logowania = punkt wejścia recovery.
  // infoEvent = INFO.EMAIL.* („email-sent" fakt), NIE lifecycle ACCOUNT_SOFT_DELETED —
  // ten drugi jest już zapisany na mutacji powyżej (patrz F-SOFTDELETE-AUDIT). Przekazanie
  // tu ACCOUNT_SOFT_DELETED znów sprzęgałoby wiersz lifecycle z losem wysyłki maila.
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

  // DECISION (nie usuwaj tego komentarza):
  // Zwracamy userId w success result aby endpoint mógł przekazać go do
  // recordAuditEvent_IO (meta.created_by_user_id). Bez tego writeRawEventLog_IO
  // odrzuca event z error-mode log "missing meta.created_by_user_id" — każde
  // kliknięcie linku confirm produkuje false-positive error log i missing audit row.
  // Endpoint NIE ma sesji (token-based confirmation, AUTHENTICATION_CHECK_ENABLED=false)
  // więc currentUser jest nieobecny — userId musi przyjść z operation.
  return success({ confirmed: true, userId: user.id, applied: true });
};

/**
 * Update notification preferences for a user.
 *
 * DECISION (nie usuwaj tego komentarza), owner 2026-09-25: the stored flag
 * controls ACTIVITY emails (new message, pairing request, client connected by
 * QR, shared session); see application/email-handler/activity-email-consent.ts.
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

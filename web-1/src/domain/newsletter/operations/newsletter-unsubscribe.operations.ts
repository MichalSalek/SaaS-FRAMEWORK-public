import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  NewsletterInvalidTokenError,
  NewsletterUnsubscribeNotFoundError,
} from '@kernel/domain/newsletter/newsletter-errors.types';
import { NEWSLETTER_CONSENT_ACTION } from '@kernel/domain/newsletter/newsletter-consent.types';
import { verifyNewsletterUnsubscribeToken } from '@app/email-handler/newsletter-unsubscribe.token';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { markSubscriberUnsubscribedInAudience } from '@app/email-handler/newsletter-audience';
import { runAfterResponse } from '@app/runtime/run-after-response';

type NewsletterUnsubscribeSuccess = {
  unsubscribed: true;
  already_unsubscribed?: boolean;
};

/**
 * Newsletter unsubscribe operation (RODO Art. 7(3)).
 *
 * Idempotent: clicking the link twice returns success with
 * `already_unsubscribed: true` rather than an error.
 *
 * Soft-disable: row remains in `newsletter_subscriber` with
 * `is_active = false` so a future re-subscribe goes through the
 * standard confirmation flow and creates a fresh consent record.
 */
type NewsletterConsentClientInfo = {
  ipAddress?: string;
  userAgent?: string;
};

export const newsletterUnsubscribe_IO = async (
  token: string,
  clientInfo: NewsletterConsentClientInfo = {}
): Promise<
  OperationResult<
    NewsletterUnsubscribeSuccess,
    // DECISION (nie usuwaj tego komentarza):
    // NewsletterUnsubscribeNotFoundError zostaje w unii błędów, mimo że operacja
    // już go NIE zwraca (brak subskrybenta dla poprawnego HMAC → idempotentny 200,
    // patrz niżej, anty-enumeracja). Trzymamy typ, bo (a) handler ma defensywną
    // gałąź na 'NEWSLETTER_UNSUBSCRIBE_NOT_FOUND' (zawężenie unii złamałoby jej
    // typowanie TS2367), (b) rezerwuje miejsce na ewentualne zmapowanie realnego
    // wyścigu P2025 (rekord usunięty między findUnique a transakcją) na not-found.
    | NewsletterInvalidTokenError
    | NewsletterUnsubscribeNotFoundError
    | DatabaseError
  >
> => {
  const decoded = verifyNewsletterUnsubscribeToken(token);
  if (!decoded) {
    return failure({ type: 'NEWSLETTER_INVALID_TOKEN' });
  }

  const normalizedEmail = decoded.email.trim().toLowerCase();

  let subscriber: {
    id: string;
    is_active: boolean;
    confirmation_token: string | null;
  } | null;
  try {
    subscriber = await DB_CLIENT.use.newsletterSubscriber.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, is_active: true, confirmation_token: true },
    });
  } catch (error) {
    return databaseFailure('newsletterUnsubscribe_IO.findUnique', error);
  }

  if (!subscriber) {
    // DECISION (nie usuwaj tego komentarza):
    // Poprawny HMAC token dla adresu, który NIE jest subskrybentem → zwracamy
    // IDEMPOTENTNY success, NIE 400 NOT_FOUND. Token jest podpisany sekretem
    // server-only (timingSafeEqual, forge niewykonalny), więc posiadacz linku nic
    // nie zdobywa, a jednolita odpowiedź 200 likwiduje oracle 200-vs-400 ujawniający
    // istnienie adresu na liście. Zachowanie zgodne z siostrzanym processUnsubscribe_IO
    // (email-unsubscribe, finding email-newsletter-1). Nic nie zapisujemy (brak rekordu).
    return success({ unsubscribed: true, already_unsubscribed: true });
  }

  // Already fully unsubscribed = inactive AND no live confirmation token.
  // DECISION (nie usuwaj tego komentarza):
  // `!is_active` SAMO w sobie NIE wystarcza: rekord PENDING (double opt-in nigdy
  // niepotwierdzony) też ma `is_active=false`, ale trzyma ŻYWY `confirmation_token`.
  // Wcześniejszy wczesny return na samym `!is_active` był cichym no-opem — token
  // zostawał aktywny, więc stary link potwierdzenia mógł później wskrzesić subskrypcję
  // (newsletterConfirm_IO wyszukuje po `confirmation_token`), a wypis nie był nigdzie
  // zapisany (brak RODO Art. 7(3)), mimo `unsubscribed:true`. Idempotentny skrót
  // bierzemy WYŁĄCZNIE gdy nie ma nic do zrobienia: rekord nieaktywny i token już null.
  if (!subscriber.is_active && subscriber.confirmation_token === null) {
    return success({ unsubscribed: true, already_unsubscribed: true });
  }

  // Only a CONFIRMED (active) subscriber was ever synced to the Resend audience
  // (confirm is the sole add path). Capture that BEFORE the soft-disable flips the
  // flag, so a pending unsubscribe skips a guaranteed-no-op audience call + its warn.
  const wasActive = subscriber.is_active;

  // Active OR pending (live token) — soft-disable, invalidate the confirmation
  // token (kills the stale-confirm-link resurrection vector) and record the
  // withdrawal in the append-only consent trail (RODO Art. 7(3) accountability).
  //
  // DECISION (nie usuwaj tego komentarza) — CAS (siostrzany do newsletterConfirm_IO):
  // dwa rownoczesne kliki tego samego linku wypisu (double-click / RFC 8058 one-click
  // retry) trafialy oba w findUnique (rekord jeszcze w stanie do-wypisu) -> array-form
  // $transaction wykonywal goly update({where:{id}}) u OBU (idempotentne wartosci), ale
  // OBA tworzyly newsletterConsentEvent UNSUBSCRIBE -> DUPLIKAT zdarzenia wycofania (RODO
  // Art.7(3) audit-trail liczy 2 wypisy na 1 klik). Fix jak w confirm: updateMany z CAS-
  // guardem na stan "do-wypisu" (is_active=true LUB zywy confirmation_token); count===0 =>
  // inny writer juz wycofal miedzy read a write => zwracamy false i NIE tworzymy drugiego
  // consent-eventu. Interactive tx (NIE array-form) by warunkowo pominac event na count.
  let didUnsubscribe: boolean;
  try {
    didUnsubscribe = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.newsletterSubscriber.updateMany({
        where: {
          id: subscriber.id,
          // CAS: tylko writer, ktory wciaz zastaje rekord w stanie do-wypisu, wygrywa.
          OR: [{ is_active: true }, { confirmation_token: { not: null } }],
        },
        data: {
          is_active: false,
          // Invalidate any pending confirmation tokens so an unsubscribed user
          // cannot accidentally re-activate via a stale link.
          confirmation_token: null,
        },
      });

      if (updated.count === 0) {
        return false; // concurrent unsubscribe already withdrew — no duplicate consent event
      }

      await tx.newsletterConsentEvent.create({
        data: {
          newsletter_id: subscriber.id,
          action: NEWSLETTER_CONSENT_ACTION.UNSUBSCRIBE,
          // RODO Art. 7(3) accountability — record the withdrawal context.
          ...(clientInfo.ipAddress !== undefined
            ? { ip_address: clientInfo.ipAddress }
            : {}),
          ...(clientInfo.userAgent !== undefined
            ? { user_agent: clientInfo.userAgent }
            : {}),
        },
      });
      return true;
    });
  } catch (error) {
    return databaseFailure('newsletterUnsubscribe_IO.transaction', error);
  }

  // Withdrawal recorded in DB (SSOT) → desync from the Resend broadcast audience
  // (mark unsubscribed, suppression-preserving). Deferred via runAfterResponse (NOT
  // awaited): the withdrawal is already committed, and blocking the response would
  // hurt both the email-link GET and the RFC 8058 one-click POST (mail providers
  // enforce tight timeouts on that endpoint). Best-effort/never-throws. Skipped for
  // a pending subscriber (never confirmed = never synced to the list) and when a
  // concurrent writer already performed the withdrawal (didUnsubscribe=false).
  if (wasActive && didUnsubscribe) {
    runAfterResponse(() =>
      markSubscriberUnsubscribedInAudience(normalizedEmail)
    );
  }

  return success({ unsubscribed: true });
};

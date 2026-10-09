/**
 * Email Unsubscribe Operations
 *
 * SRP: Process unsubscribe requests via HMAC-signed token.
 * Domain operation with I/O (DB access).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';
import { TIME } from '@kernel/application/constants.config';
import type { EmailPreferences } from '@kernel/models/email/email.dto';
import type {
  EmailInvalidUnsubscribeTokenError,
  EmailUnsubscribeTokenExpiredError,
  EmailUserNotFoundError,
  EmailTransactionalNotUnsubscribableError,
} from '@kernel/domain/email/email-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { verifyUnsubscribeToken } from '@app/email-handler/email-unsubscribe.token';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * Process an unsubscribe request.
 *
 * 1. HMAC verify token
 * 2. Check TTL
 * 3. Fetch StylistAccount
 * 4. Update email_preferences JSON
 * 5. Push EventLog
 * 6. Return success
 */
export const processUnsubscribe_IO = async (
  token: string
): Promise<
  OperationResult<
    { category: EmailCategory; already_unsubscribed?: boolean },
    | EmailInvalidUnsubscribeTokenError
    | EmailUnsubscribeTokenExpiredError
    | EmailUserNotFoundError
    | EmailTransactionalNotUnsubscribableError
    | DatabaseError
  >
> => {
  // 1. Verify token
  const decoded = verifyUnsubscribeToken(token);
  if (!decoded) {
    return failure({ type: 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN' });
  }

  // 2. Check TTL — both bounds.
  const tokenAgeDays = (Date.now() - decoded.timestamp) / TIME.MS_PER_DAY;

  // 2a. Future-dated token (negative age) = forged/tampered, NOT a real expired link.
  // DECISION (nie usuwaj tego komentarza):
  // timestamp > now jest niemożliwy dla tokena podpisanego przez nasz serwer
  // (generateHmacToken stempluje Date.now(), zawsze ≤ teraz). Wiek < 0 oznacza więc
  // manipulację (atak ze znanym sekretem albo wstrzyknięty timestamp), nie wygaśnięcie
  // — odrzucamy jako INVALID, zanim dotkniemy DB/preferencji. Bez tego górny TTL-gate
  // przepuszczał future-dated token w success-path (finding email-comms-2). Sam HMAC
  // nie chroni: napastnik podpisuje dowolny timestamp. verifyHmacToken ma identyczny
  // guard `age < 0`, ale tylko gdy dostanie ttlMs — verifyUnsubscribeToken go nie
  // przekazuje (zmiana sygnatury = kernel-level), więc dolny gate egzekwujemy tutaj.
  if (tokenAgeDays < 0) {
    return failure({ type: 'EMAIL_INVALID_UNSUBSCRIBE_TOKEN' });
  }

  // 2b. Expired token (older than TTL) = legitimate link past its validity window.
  if (tokenAgeDays > EMAIL_LIFECYCLE_CONFIG.UNSUBSCRIBE_TOKEN_TTL_DAYS) {
    return failure({ type: 'EMAIL_UNSUBSCRIBE_TOKEN_EXPIRED' });
  }

  // 2c. Resolve the preference key for this category.
  // TRANSACTIONAL has no preference key (cannot be unsubscribed — PKE compliance).
  // DECISION (nie usuwaj tego komentarza):
  // Dla TRANSACTIONAL zwracamy jawny błąd domenowy zamiast „cichego" success.
  // Wcześniej operacja robiła no-op (spread `...(prefKey ? ... : {})`) i mimo to
  // kończyła success(), przez co handler odsyłał `unsubscribed:true` dla operacji,
  // która niczego nie zmieniła (mylący kontrakt — finding email-newsletter-2).
  // Serwer normalnie NIE generuje tokenów TRANSACTIONAL (maile transakcyjne nie mają
  // linku wypisu), a forge przez HMAC jest niewykonalny, więc to ścieżka brzegowa,
  // ale odpowiedź ma być prawdziwa: „transactional cannot be unsubscribed".
  const prefKey = getCategoryPrefKey(decoded.category);
  if (prefKey === null) {
    return failure({
      type: 'EMAIL_TRANSACTIONAL_NOT_UNSUBSCRIBABLE',
      category: decoded.category,
    });
  }

  // 3. Fetch StylistAccount by user ID
  // DECISION (PRMA email_preferences Phase 2, 2026-05-27):
  // Reads z typed Boolean columns (email_marketing, email_trial_sequence).
  // JSON `email_preferences` zachowany jako shadow dla rollback safety.
  // Phase 3 (separate PR) — drop JSON column po zweryfikowaniu zero rollback need.
  let account;
  try {
    account = await DB_CLIENT.use.stylistAccount.findFirst({
      where: { created_by_user_id: decoded.userId },
      select: {
        account_id: true,
        email_marketing: true,
        email_trial_sequence: true,
      },
    });
  } catch (error) {
    return databaseFailure('processUnsubscribe_IO:fetchAccount', error);
  }

  if (!account) {
    // DECISION (nie usuwaj tego komentarza):
    // Brak StylistAccount dla userId z (poprawnego HMAC) tokena → zwracamy
    // IDEMPOTENTNY success, NIE 404. Token jest podpisany sekretem server-only
    // (timingSafeEqual, forge niewykonalny), więc posiadacz linku i tak nie zdobywa
    // nic nowego, a jednolita odpowiedź 200 likwiduje oracle ujawniający istnienie
    // konta / stan preferencji (finding email-newsletter-1: 3-way 200/400/404).
    // Nic nie zapisujemy (brak konta) i nie logujemy — z perspektywy klienta wypis
    // jest „już dokonany". EMAIL_USER_NOT_FOUND pozostaje dla wyścigu P2025 w UPDATE
    // (równoległe usunięcie konta między fetch a update — realny not-found, nie oracle).
    return success({ category: decoded.category, already_unsubscribed: true });
  }

  // 4. Build current preferences directly from Boolean columns (no JSON parse)
  const currentPrefs: EmailPreferences = {
    trial_sequence: account.email_trial_sequence,
    marketing: account.email_marketing,
  };

  // 4b. Idempotency: if already unsubscribed from this category, return success.
  // DECISION (nie usuwaj tego komentarza):
  // Re-klik poprawnego linku wypisu (pref już = false) → success({already_unsubscribed:true}),
  // NIE błąd 400. Zachowanie zgodne z siostrzanym newsletterUnsubscribe_IO (RODO Art.7(3)).
  // Wcześniejszy EMAIL_ALREADY_UNSUBSCRIBED → 400 VALIDATION_FAILED łamał idempotencję
  // i tworzył oracle 200-vs-400 ujawniający bieżący stan preferencji posiadaczowi tokena
  // (finding email-newsletter-1). Pomijamy zbędny zapis do DB dla braku zmiany.
  if (currentPrefs[prefKey] === false) {
    return success({ category: decoded.category, already_unsubscribed: true });
  }

  // Update the preference (prefKey is non-null here — TRANSACTIONAL rejected above)
  const updatedPrefs: EmailPreferences = {
    ...currentPrefs,
    [prefKey]: false,
  };

  try {
    await DB_CLIENT.use.stylistAccount.update({
      where: { account_id: account.account_id },
      data: {
        email_preferences: updatedPrefs,
        email_marketing: updatedPrefs.marketing,
        email_trial_sequence: updatedPrefs.trial_sequence,
      },
    });
  } catch (error) {
    if (isP2025(error)) {
      return failure({ type: 'EMAIL_USER_NOT_FOUND', userId: decoded.userId });
    }
    return databaseFailure('processUnsubscribe_IO', error);
  }

  // 5. Push EventLog — runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
  runAfterResponse(() =>
    recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_UNSUBSCRIBE_SUCCESS,
      user: { id: decoded.userId },
      responseBody: {
        category: decoded.category,
        preferences: updatedPrefs,
      },
    })
  );

  // 6. Return success
  return success({ category: decoded.category });
};

/**
 * Map EmailCategory to EmailPreferences key.
 * TRANSACTIONAL cannot be unsubscribed.
 */
const getCategoryPrefKey = (
  category: EmailCategory
): keyof EmailPreferences | null => {
  switch (category) {
    case 'TRIAL_SEQUENCE':
      return 'trial_sequence';
    case 'MARKETING':
      return 'marketing';
    case 'TRANSACTIONAL':
      return null; // Cannot unsubscribe from transactional
    default: {
      const _exhaustive: never = category;
      void _exhaustive;
      return null;
    }
  }
};

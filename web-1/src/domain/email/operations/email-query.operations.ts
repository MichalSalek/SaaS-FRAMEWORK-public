/**
 * Email Query Operations
 *
 * SRP: Admin-facing read operations for email lifecycle.
 */

import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import {
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  DUNNING_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
  EMAIL_CATEGORY,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import type {
  CancelEmailRule,
  TrialEmailRule,
} from '@kernel/domain/email/email-schedule.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { allowedEventLogTypeSets } from '@kernel/domain/event-log/event_log.config';
import { isEventInfoNarrower } from '@kernel/models/type_narrowing';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { EmailHistoryEntry } from '@domain/email/email.types';

type ScheduleResponse = {
  schedule: readonly TrialEmailRule[];
  cancelSchedule: readonly CancelEmailRule[];
};

type HistoryResponse = {
  emails: EmailHistoryEntry[];
  nextCursor: string | null;
};

/**
 * Map event name -> email category.
 * Built from SSOT schedule configs + known transactional events.
 */
const eventToCategoryMap = new Map<EVENT_INFO_TYPE, EmailCategory>();

// Trial + cancel schedule events (from config SSOT)
for (const rule of TRIAL_EMAIL_SCHEDULE) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}
for (const rule of CANCEL_EMAIL_SCHEDULE) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}
for (const rule of DUNNING_EMAIL_SCHEDULE) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}
// Standalone single-rule configs (sweep operations) — without these the admin
// Email History panel showed their sends as category UNKNOWN.
for (const rule of [
  ONBOARDING_ABANDONMENT_RULE,
  RENEWAL_REMINDER_RULE,
  WINBACK_DELETION_RULE,
]) {
  eventToCategoryMap.set(rule.infoEvent, rule.category);
}

// Transactional events (not in schedule — triggered by business events)
const TRANSACTIONAL_EVENTS = [
  APP_EVENTS.INFO.EMAIL.EMAIL_UPGRADE_CONFIRMATION_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_DOWNGRADE_NOTIFICATION_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_PAIRING_NOTIFICATION_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_PAYMENT_FAILED_SENT,
  // Dunning auto-downgrade notification (dunning-downgrade.operation.ts) —
  // billing-state change, cannot unsubscribe.
  APP_EVENTS.INFO.EMAIL.EMAIL_DUNNING_AUTO_DOWNGRADE,
  // Per-user dead-letter marker (magic-link / transactional send failed on all
  // transports) — the underlying email is transactional.
  APP_EVENTS.INFO.EMAIL.EMAIL_DEAD_LETTERED,
  // DECISION (nie usuwaj tego komentarza):
  // Admin-operacyjne sendy (EMAIL_ADMIN_*_SENT, ALERT_*_SENT) NIE są tu mapowane na
  // kategorię i ŚWIADOMIE wykluczone z historii per-user (EMAIL_HISTORY_CONTROL_EVENTS
  // poniżej). Maile lecą do skrzynki ADMINA, ale EventLog loguje je pod id dotkniętego
  // usera (churn → id rezygnującego klienta) dla korelacji → bez wykluczenia user widziałby
  // „EMAIL_ADMIN_CHURN_ALERT_SENT" we WŁASNEJ historii, jakby dostał ten mail (leak/mylące).
  // To re-charakteryzacja r1b: poprzednio dorzucone tu jako TRANSACTIONAL „żeby admin panel
  // nie pokazywał UNKNOWN" — ale admin panel używa ?userId override i widzi je tak czy siak
  // przez get-history; per-user (currentUser.id, IDOR-default) NIE może. Domknięte po cross-
  // model review (GPT-5.5), żeby zatrzymać ping-pong include/exclude — patrz DECISION przy
  // EMAIL_HISTORY_CONTROL_EVENTS.
] as const;
for (const event of TRANSACTIONAL_EVENTS) {
  eventToCategoryMap.set(event, EMAIL_CATEGORY.TRANSACTIONAL);
}

// DECISION (nie usuwaj tego komentarza):
// EMAIL_HISTORY_CONTROL_EVENTS = zdarzenia z bucketu EventLogTypeValue.EMAIL, które NIE
// należą do historii e-maili DANEGO usera. Dwie rozłączne klasy:
//
//   (A) CONTROL/AUDIT — w ogóle nie są wysyłką maila, lecz markerami procesu (mutacje
//       preferencji, sweep-marker, transport-failure, circuit-breaker).
//
//   (B) ADMIN-OPERACYJNE WYSYŁKI — to PRAWDZIWE wysyłki, ale do skrzynki ADMINA, nie do
//       usera, pod którego id są logowane. EventLog zapisuje je pod created_by_user_id
//       dotkniętego usera DLA KORELACJI (churn-alert → id rezygnującego klienta; digest/
//       anomaly → system actor), a sam mail leci na adres admina (sendCriticalBusinessAlert).
//       Bez wykluczenia non-admin przez get-history (default targetUserId = currentUser.id,
//       IDOR-safe) zobaczyłby „EMAIL_ADMIN_CHURN_ALERT_SENT" we WŁASNEJ historii, jakby ten
//       mail dostał = mylące/leaky. Panel admina też woła get-history per-user (?userId =
//       KONKRETNY user) → „historia e-maili TEGO usera" = maile wysłane DO niego, więc alert
//       admina i tam nie należy. Pełny audyt admin-operacyjnych żyje w przeglądarce EventLog
//       (event_type=EMAIL bez filtra user-a), nie w per-user endpoint. To re-charakteryzacja
//       po cross-model review (GPT-5.5 na r1b): r1 sugerował INCLUDE (TRANSACTIONAL), r1b to
//       wdrożył; poprawny kierunek to EXCLUDE. Decyzja domknięta TU, by zatrzymać ping-pong
//       include/exclude (dwukrotnie iterowana — nie re-litygować po raz trzeci).
//
// Wybór wykluczenia (NOT IN controls) zamiast pozytywnego send-setu jest CELOWY: nowy
// USER-FACING event-wysyłka dodany do bucketu EMAIL w przyszłości jest automatycznie
// WIDOCZNY w historii (bezpieczny default „to wysyłka do usera, chyba że jawnie oznaczone
// jako control/admin"). EMAIL_SEND_FAILED zostaje controlem (marker porażki transportu, nie
// udana wysyłka); EMAIL_DEAD_LETTERED zostaje wysyłką (per-user marker, że transakcyjny mail
// do TEGO usera wyczerpał transporty — spójnie z mapą kategorii TRANSACTIONAL).
const EMAIL_HISTORY_CONTROL_EVENTS = [
  // (A) control/audit — nie-wysyłki
  APP_EVENTS.INFO.EMAIL.EMAIL_PREFERENCES_UPDATED,
  APP_EVENTS.INFO.EMAIL.EMAIL_UNSUBSCRIBE_SUCCESS,
  APP_EVENTS.INFO.EMAIL.EMAIL_SWEEP_COMPLETED,
  APP_EVENTS.INFO.EMAIL.EMAIL_SEND_FAILED,
  APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_OPEN,
  APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_WARNING,
  APP_EVENTS.INFO.EMAIL.EMAIL_CIRCUIT_BREAKER_BLOCKED,
  // (B) admin-operacyjne wysyłki — mail do skrzynki admina, logowany pod id dotkniętego
  // usera (korelacja); NIE „mail wysłany do tego usera" → poza per-user historią.
  APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_SIGNUP_DIGEST_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_CHURN_ALERT_SENT,
  APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_DOWNGRADE_ALERT_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_PAIRING_ANOMALY_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_UPLOAD_ERROR_RATE_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_VOLUME_SENT,
  APP_EVENTS.INFO.EMAIL.ALERT_IMPERSONATION_OFF_HOURS_SENT,
] as const;

// DECISION (nie usuwaj tego komentarza):
// Drift-guard: każdy control event MUSI należeć do bucketu EMAIL (event_log.policy SSOT).
// Jeśli kernel kiedyś przeniesie/zmieni nazwę któregoś, throw przy module-init łapie to
// natychmiast (fail-fast w teście/boot) zamiast cichego no-op filtra. To nie tworzy listy
// pozytywnej — wciąż filtrujemy NOT IN controls; ta asercja tylko pilnuje, że wykluczenia
// odnoszą się do realnych członków bucketu.
const emailBucket = allowedEventLogTypeSets[EventLogTypeValue.EMAIL];
for (const controlEvent of EMAIL_HISTORY_CONTROL_EVENTS) {
  if (!emailBucket.has(controlEvent)) {
    throw new Error(
      `email-query: control event "${controlEvent}" is not in the EMAIL EventLog bucket — event_log.policy drift`
    );
  }
}

/**
 * Resolve email category from event name.
 * Returns 'UNKNOWN' only if event name is not in any known mapping.
 */
const resolveEmailCategory = (
  eventName: EVENT_INFO_TYPE
): EmailCategory | 'UNKNOWN' => eventToCategoryMap.get(eventName) ?? 'UNKNOWN';

/**
 * Get the email schedule config.
 * Pure read-only — returns SSOT config, zero DB access.
 */
export const getEmailSchedule_IO = async (): Promise<
  OperationResult<ScheduleResponse, never>
> => {
  return success({
    schedule: TRIAL_EMAIL_SCHEDULE,
    cancelSchedule: CANCEL_EMAIL_SCHEDULE,
  });
};

/**
 * Get email history for a specific user with cursor pagination (default 50, max 100).
 * Queries EventLog WHERE event_type = 'EMAIL' for the given userId.
 * Cursor by event_log_id; orderBy event_log_id desc for stable traversal.
 * Category is resolved from event name via schedule config (SSOT).
 */
export const getEmailHistory_IO = async (
  userId: string,
  pagination?: { cursor?: string | undefined; take?: number | undefined }
): Promise<
  OperationResult<HistoryResponse, DatabaseError | ValidationError>
> => {
  const cursor = pagination?.cursor;
  const take = pagination?.take ?? 50;
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // DECISION (nie usuwaj tego komentarza):
  // Format-gate cursora PRZED findMany (wzorzec SSOT z gallery-explore.query.ts —
  // isValidCursorFormat @kernel validation.utils). Bez tego null-byte (\0) lub inny
  // niezgodny z PG `text` cursor rzucałby w findMany → niezmapowany 500 GENERAL_ERROR.
  // Malformowany/non-cuid cursor = jednolity kontrakt VALIDATION_ERROR 400 'Invalid cursor'
  // (zamyka też cuid existence-oracle defense-in-depth — helper DECISION). Existence
  // pre-check pominięty: brak osobnego ownership lookupu do reużycia, a FE odtwarza tylko
  // server-issued cursory (200-empty na valid-format stale cursor akceptowalne).
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'cursor',
      message: 'Invalid cursor',
    });
  }

  try {
    const eventLogs = await DB_CLIENT.use.eventLog.findMany({
      where: {
        event_type: EventLogTypeValue.EMAIL,
        created_by_user_id: userId,
        // DECISION (nie usuwaj tego komentarza):
        // FILTR NA POZIOMIE ZAPYTANIA (nie post-fetch). Bucket EMAIL zawiera też
        // zdarzenia control/audit (EMAIL_HISTORY_CONTROL_EVENTS). Wykluczenie ich w
        // WHERE sprawia, że kursor/paginacja wędrują po ZBIORZE PRZEFILTROWANYM —
        // strona nigdy nie zwija się do pustej, gdy istnieją starsze wysyłki (poprzedni
        // post-fetch filtr potrafił wyzerować stronę, a FE nie dociągał kolejnej mimo
        // nextCursor → user widział pustą historię: finding email-comms-1b). Każda
        // faktyczna wysyłka DO TEGO usera przechodzi; admin-operacyjne sendy (digest/
        // churn/alert) są WYKLUCZONE — należą do EMAIL_HISTORY_CONTROL_EVENTS (klasa B:
        // mail do skrzynki ADMINA, logowany pod id usera dla korelacji, NIE wysłany do
        // niego; patrz DECISION przy EMAIL_HISTORY_CONTROL_EVENTS). Spread do mutowalnej
        // tablicy: Prisma `notIn` oczekuje `string[]`,
        // a EMAIL_HISTORY_CONTROL_EVENTS jest readonly (`as const` dla drift-guarda).
        event: { notIn: [...EMAIL_HISTORY_CONTROL_EVENTS] },
      },
      orderBy: { event_log_id: 'desc' },
      take: effectiveTake + 1,
      ...(cursor ? { cursor: { event_log_id: cursor }, skip: 1 } : {}),
      select: {
        event_log_id: true,
        event: true,
        created_at: true,
      },
    });

    const hasMore = eventLogs.length > effectiveTake;
    const pageItems = hasMore ? eventLogs.slice(0, effectiveTake) : eventLogs;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.event_log_id ?? null)
        : null;

    // DECISION (nie usuwaj tego komentarza):
    // Wysyłka-vs-control jest już rozstrzygnięta w WHERE (event NOT IN
    // EMAIL_HISTORY_CONTROL_EVENTS) — TUTAJ NIE filtrujemy ponownie. Mapujemy tylko
    // wiersze na EmailHistoryEntry i nadajemy etykietę `category`. Każdy wiersz, który
    // tu dociera, jest faktyczną wysyłką DO usera; resolveEmailCategory zwraca EmailCategory
    // dla wszystkich znanych wysyłek user-facing (schedule + standalone + TRANSACTIONAL).
    // Admin-operacyjne sendy (digest/churn/alert) NIE docierają tu — odsiane w WHERE jako
    // EMAIL_HISTORY_CONTROL_EVENTS (klasa B).
    // Gdyby pojawiła się NOWA wysyłka jeszcze nieobecna w mapie kategorii, `category`
    // spadnie do 'UNKNOWN' (dozwolone w EmailHistoryEntry/DTO) — wiersz NADAL jest
    // pokazany (nie gubimy realnej wysyłki; to bezpośrednio zamyka finding email-comms-2b),
    // a brakująca kategoria jest jedynie kosmetyką do dopięcia w mapie.
    const emails: EmailHistoryEntry[] = pageItems.map(log => {
      // DB stores validated EVENT_INFO_TYPE values (written by writeRawEventLog_IO using APP_EVENTS SSOT).
      // Narrow defensively — corrupt DB rows fall back to GENERAL_ERROR rather than crashing the page.
      const narrowedEvent: EVENT_INFO_TYPE = isEventInfoNarrower(log.event)
        ? log.event
        : APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR;
      return {
        event_log_id: log.event_log_id,
        event: narrowedEvent,
        sentAt: log.created_at.toISOString(),
        category: resolveEmailCategory(narrowedEvent),
      };
    });

    return success({ emails, nextCursor });
  } catch (error) {
    return databaseFailure('getEmailHistory', error);
  }
};

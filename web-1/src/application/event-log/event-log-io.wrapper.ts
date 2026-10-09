import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
// Import from real sources, NOT the @app/interceptors barrel.
// The barrel re-exports email-lifecycle/janitor interceptors that import back
// recordAuditEvent_IO from THIS file → 27 circular deps. Direct imports cut it.
import { fillUserMetadataWithLocation } from '@domain/user/user.utils.api';
import { getUser_IO } from '@domain/user/operations/user-crud.operations';
import type {
  EventLog,
  Session,
  User,
} from '@kernel/models/db_models.generated.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import { EVENT_LOG_POLICY } from '@kernel/policies/event_log.policy';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { PushEventLogToDB } from './event-log.client';
import { writeRawEventLog_IO } from './event-log.client';
import { isEmailKey } from '@app/debugger/pii-redaction';
import { getCurrentRequestImpersonatingAdminId } from '@app/http/request-context';

// DECISION (nie usuwaj tego komentarza):
// recordAuditEvent_IO domyslnie strip'uje user.email z eventPayload.user (zostawia tylko id).
// PII z requestBody MUSI byc explicite redacted przez caller via redactAuditPayload(body, [allowed]).
// Powod: GDPR data minimization. Wiersze audytu (EventLog) NIE sa przycinane; retencja 90 dni
// dotyczy tylko logu aplikacji (AppLogRecord), patrz docs/LOGGING.md. Email/phone/nazwy/notes NIGDY w audit log.
// `meta.created_by_user_id` (osobna kolumna w event_log) wystarcza do identyfikacji.
// Pattern referencji: support/create-thread (loguje tylko subject), gallery/report (record_id + reason).

/**
 * Audit log PII redaction.
 *
 * Default: returns ONLY allowed keys. Use to prevent PII bloat in event_log table.
 *
 * Usage:
 *   const safePayload = redactAuditPayload(body, ['gallery_record_id', 'reason']);
 *
 * For UI/operation context (NOT direct PII): pass ['feature_name', 'plan_tier', etc].
 */
export const redactAuditPayload = <T extends Record<string, unknown>>(
  body: T,
  allowedKeys: readonly (keyof T)[]
): Partial<T> => {
  const safe: Partial<T> = {};
  for (const key of allowedKeys) {
    if (key in body) {
      safe[key] = body[key];
    }
  }
  return safe;
};

// DECISION (nie usuwaj tego komentarza):
// Defense-in-depth deny-list. GLOWNA kontrola PII to allowlist (redactAuditPayload)
// wywolywana explicite przez caller. To OSTATNIA linia obrony: jesli handler ZAPOMNI
// redaktu (np. `requestBody: body` raw), znane klucze PII sa i tak stripowane z
// requestBody/responseBody przed zapisem (EventLog trzymany bezterminowo). Shallow (top-level) —
// request bodies trzymaja PII na 1. poziomie; glebsze zagniezdzenia = bug do redaktu
// na call-site. Drop loguje warn, by ujawnic brakujacy redact (nie cichy fallback).
// Bezpieczne wobec intencjonalnych allowlistow: zaden call-site nie allowlistuje tych
// kluczy (allowlistowane: gallery_record_id/reason/nail_length/role/session_id/side/
// vanity/social) — wiec deny nie koliduje ze swiadoma decyzja.
// DECISION (nie usuwaj tego komentarza) — S113, po przeglądzie:
// Klucze niosące ADRES dociągamy z `pii-redaction.ts`, zamiast utrzymywać drugą,
// równoległą listę. Rozjazd był realny i kosztowny: tamta lista miała `to`,
// `recipient`, `newEmail`, `identifier`, a TA nie — a to właśnie ta obsługuje
// `writeRawEventLog_IO`, którym adapter magic-linka i transport pocztowy zapisują
// `to`/`identifier`. Adres wyciekał więc drugim pisarzem, mimo redakcji w pierwszym.
// Mechanizm zostaje różny świadomie: tutaj klucz jest KASOWANY (to ostatnia linia
// obrony przy surowych ciałach żądań), a w loggerze redagowany do domeny.
// Rodzinę adresową rozstrzyga PREDYKAT `isEmailKey` (wzorzec `*mail(s)`), a nie
// kopia nazw: kiedy była tu wyliczanka, `userEmail` i `reporterEmail` przechodziły
// obiema ścieżkami naraz. Porównanie idzie po kluczu ZNORMALIZOWANYM, bo to ostatnia
// linia obrony przy SUROWYCH ciałach żądań — a te przychodzą z zewnątrz i nie mają
// obowiązku trzymać się naszej konwencji nazw (`Email`, `NEW_EMAIL`, `Notes`).
const PII_DENY_NAMES = [
  'phone',
  'contact_phone',
  'address_street',
  'address_postal_code',
  'name',
  'display_name',
  'first_name',
  'last_name',
  'description',
  'content',
  'notes',
] as const;

/** Separatory znikaja po OBU stronach porownania — inaczej `firstName` przechodzil,
 *  a `first_name` nie, choc to ten sam fakt. Surowe ciala zadan nie maja obowiazku
 *  trzymac sie naszej konwencji nazw, a to jest ostatnia linia obrony wlasnie przy nich. */
const normalizeKey = (key: string): string =>
  key.toLowerCase().replace(/[_\-.]/g, '');

const PII_DENY_KEYS = new Set<string>(PII_DENY_NAMES.map(normalizeKey));

const isPiiKey = (key: string): boolean =>
  isEmailKey(key) || PII_DENY_KEYS.has(normalizeKey(key));

/**
 * DECISION (nie usuwaj tego komentarza) — LICZBA I BOOL NIE SA ADRESEM:
 * kasujemy klucz PII tylko wtedy, gdy jego wartosc W OGOLE MOZE niesc dane
 * osobowe. Inaczej rozszerzenie rozpoznawania nazw uderza w pola, ktore sa
 * WLASNIE ucieczka od PII: `has_email: true` w `client/update-contact` istnieje
 * po to, zeby zamiast adresu zapisac sam fakt jego podania — skasowanie go
 * zabiera jedyny sygnal, jaki ten wpis niosl, i dokłada falszywe ostrzezenie
 * „dropped PII key" przy kazdym zapisie. Ta sama zasada, ktora `redactEmailValue`
 * stosuje od dawna po drugiej stronie („`recipient: 42` to legalne, nie-adresowe
 * uzycie tej samej nazwy pola").
 * WYLACZNIE `boolean`: liczba NIE jest bezpieczna i pierwotnie byla tu przez
 * pomylke — `{"phone": 48123456789}` albo `{"address_postal_code": 12345}`
 * w surowym ciele zadania to PELNOPRAWNE dane osobowe, a wlasnie surowe ciala
 * sa powodem, dla ktorego ta warstwa istnieje (siedemnascie handlerow podaje
 * `requestBody: body` bez allowlisty). Uzasadnienie dotyczylo `has_email: true`
 * i tylko flag: fakt „pole bylo podane" nie da sie zapisac w adresie.
 * Obiekty i tablice kasujemy dalej: pod kluczem adresowym moga ukrywac adres
 * o dowolna warstwe glebiej.
 */
const valueCanCarryPii = (value: unknown): boolean =>
  typeof value !== 'boolean';

const stripPiiDefenseInDepth = <T extends object>(
  body: T,
  context: string
): T => {
  let dropped: string[] | null = null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (isPiiKey(key) && valueCanCarryPii(value)) {
      (dropped ??= []).push(key);
      continue;
    }
    safe[key] = value;
  }
  if (dropped) {
    reportIssueBackend({
      namespace: 'recordAuditEvent_IO',
      message: `Defense-in-depth: dropped PII key(s) [${dropped.join(', ')}] from ${context} — call site should use redactAuditPayload`,
      payload: null,
      mode: 'warn',
    });
  }
  return safe as T;
};

export type AuditEventInput = {
  eventName: EVENT_INFO_TYPE;
  user?:
    | (Partial<Pick<User, 'id' | 'email'>> & Partial<Pick<Session, 'userId'>>)
    | null;
  requestBody?: object;
  responseBody?: object | null;
  metadata?: UserMetadata;
};
export const recordAuditEvent_IO = async (
  props: AuditEventInput
): Promise<EventLog | undefined> => {
  const { eventName, user, requestBody, responseBody, metadata } = props;

  try {
    if (
      !EVENT_LOG_POLICY.utils.GET_PERMISSION_APPROVAL_TO_PUSH_EVENT_LOG(
        eventName
      )
    ) {
      return undefined;
    }

    const meta: Partial<PushEventLogToDB['meta']> = {};
    const payload: PushEventLogToDB['eventPayloadToStringify'] = {};

    // Find id in passed user:
    // IDM migration: IDs are now strings (cuid), check for string type
    //
    if (user && 'id' in user && typeof user.id === 'string') {
      meta.created_by_user_id = user.id;
    } else if (user && 'userId' in user && typeof user.userId === 'string') {
      meta.created_by_user_id = user.userId;

      // Try to find id, maybe by email:
      //
    } else if (user && 'email' in user && typeof user.email === 'string') {
      const fetchedUser = await getUser_IO({ props: { email: user.email } });
      if (typeof fetchedUser?.id === 'string') {
        meta.created_by_user_id = fetchedUser.id;
      }
    }

    // Inside an impersonated session the row keeps the user as subject but names
    // the admin who actually acted (null for the user's own session).
    const impersonatingAdminId = await getCurrentRequestImpersonatingAdminId();
    if (impersonatingAdminId) {
      meta.impersonated_by_admin_id = impersonatingAdminId;
    }

    // Add an extra data responseBody to event log when exists:
    //
    const shouldPersistResponseBodyInEvent = Boolean(responseBody);
    if (shouldPersistResponseBodyInEvent) {
      payload.responseBody = responseBody;
    }

    // Get metadata:
    //
    const userMetadata = await fillUserMetadataWithLocation(metadata);

    const eventLogType =
      EVENT_LOG_POLICY.utils.GET_EVENT_LOG_TYPE_FOR_EVENT_LOG(eventName);
    if (!eventLogType) {
      return undefined;
    }

    // Strip PII from `user` before persisting to event_log.event_payload.
    // user_id is already persisted in meta.created_by_user_id (separate column).
    // No need to duplicate email/name in JSON payload — GDPR data minimization.
    const safeUser = meta.created_by_user_id
      ? { id: meta.created_by_user_id }
      : undefined;

    return await writeRawEventLog_IO({
      eventLogType,
      eventName,
      meta: { ...meta, ...userMetadata },
      eventPayloadToStringify: {
        requestBody: requestBody
          ? stripPiiDefenseInDepth(requestBody, 'requestBody')
          : requestBody,
        responseBody: responseBody
          ? stripPiiDefenseInDepth(responseBody, 'responseBody')
          : responseBody,
        user: safeUser,
      },
    });
  } catch (e) {
    reportIssueBackend({
      namespace: 'recordAuditEvent_IO',
      message: 'error',
      payload: e,
      mode: 'error',
    });
    return undefined;
  }
};

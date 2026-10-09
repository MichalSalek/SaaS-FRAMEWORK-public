import { PostHog } from 'posthog-node';
import { ENV_VARS } from '@app/environment/environment.config';
import { IS_PRODUCTION_ENV } from '@app/environment/environment.utils.api';
import type { ReportIssueProps } from './error-debugger.types';
import {
  isEmailKey,
  redactEmailValue,
  redactEmailsInText,
} from './pii-redaction';

// Server-side error tracking przez PostHog (dochodzi OBOK istniejącego EventLog —
// EventLog zostaje SSOT logów backendu; PostHog dodaje alerting + agregację stacktrace).
// Pojedynczy punkt wpięcia: reportIssueBackend (error-handler.ts). Guard prod-only +
// key-present => w dev / bez klucza cały pipeline to no-op (zero overheadu, zero quoty).
//
// Host = BEZPOŚREDNI EU ingest (nie /ingest reverse-proxy, który jest rewritem Next
// tylko dla przeglądarki). flushAt:1 / flushInterval:0 = wyślij od razu (błędy rzadkie,
// krytyczne by doszły nawet gdy proces zaraz ubity redeployem).

const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';

// Stały distinctId dla zdarzeń serwerowych bez kontekstu usera — unika tworzenia
// tysięcy anonimowych person-profili (Error Tracking i tak grupuje po fingerprint
// wyjątku, nie po osobie).
const BACKEND_DISTINCT_ID = 'backend';

let client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  if (!IS_PRODUCTION_ENV()) {
    return null;
  }
  const key = ENV_VARS.POSTHOG_PROJECT_KEY;
  if (!key) {
    return null;
  }
  if (!client) {
    client = new PostHog(key, {
      host: ENV_VARS.POSTHOG_HOST || DEFAULT_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

/**
 * Bounded flush kolejki PostHog — do wywołania PRZED `process.exit()`. Bez tego event
 * `$exception` z crash-path (uncaughtException → exit(1)) NIE zdąży wyjść z procesu
 * (captureException enqueue'uje async POST; exit() nie drenuje I/O). Timeout gwarantuje
 * że sam flush nie zawiesi shutdownu. Never-throw.
 */
export async function flushPostHogServer(timeoutMs = 2000): Promise<void> {
  const posthog = getPostHogServer();
  if (!posthog) {
    return;
  }
  try {
    await Promise.race([
      posthog.flush(),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // best-effort
  }
}

// DECISION (nie usuwaj tego komentarza):
// Scrub jest KEY-based, jednopoziomowy (jak SENSITIVE_KEY_REGEX w error-handler.ts).
// NIE skanujemy TREŚCI Error.message/.stack pod kątem osadzonych sekretów (np. creds
// w DATABASE_URL z błędu Prisma). To ŚWIADOMY, ograniczony zakres: identyczny z
// istniejącym EventLog, który też przepuszcza Error nietknięty (error-handler.ts
// `if (input instanceof Error) return input`). Content-scrub
// wszystkich stringów wykracza ponad tę referencję. Jeśli
// kiedyś dojdzie realny wektor (np. Prisma-error z creds w prod) — dodać content-regex
// TU (jeden seam), nie rozsypywać po call-site'ach.
//
// Klucze mogące nieść sekret — redagowane w properties (defense-in-depth; payload jest
// już scrubowany w reportIssueBackend przed EventLog, ale kanał PostHog scrubujemy
// niezależnie, bo to osobna ścieżka danych). Mirror SENSITIVE_KEY_REGEX z error-handler.
const SECRET_KEY_PATTERN =
  /(authorization|cookie|x-internal-secret|stripe-signature|api[_-]?key|access[_-]?token|refresh[_-]?token|token|sig|signature|password|secret|bearer|dsn)/i;

function scrub(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else if (isEmailKey(key)) {
      out[key] = Array.isArray(value)
        ? value.map(redactEmailValue)
        : redactEmailValue(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Wyciąga płaski, jednopoziomowy kontekst z payloadu reportIssueBackend do properties.
// Error jest obsłużony osobno (captureException wyciąga type/message/stacktrace sam),
// więc tu tylko obiekty/prymitywy trafiają jako dodatkowy kontekst.
function payloadToProps(
  payload: ReportIssueProps['payload']
): Record<string, unknown> {
  if (payload === null || payload === undefined) {
    return {};
  }
  if (payload instanceof Error) {
    return {};
  }
  if (typeof payload === 'object') {
    return scrub(payload as Record<string, unknown>);
  }
  return { payload_value: String(payload) };
}

/**
 * Buduje realny Error do `captureException` z payloadu reportIssueBackend.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Centralne funnele błędów (request.middleware unhandled-catch, process
 * unhandledRejection/uncaughtException) przekazują payload jako PLAIN OBJECT
 * `{ error|message, stack }`, NIE instancję Error. Naiwne `new Error(data.message)`
 * niosłoby stack TEJ funkcji (posthog-server) → PostHog Error Tracking grupuje
 * `$exception` po stacku, więc CAŁA klasa nieoczekiwanych wyjątków kolapsowałaby do
 * jednej „issue" z frame'ami posthog-server, niwecząc główną wartość feature
 * (agregacja po realnym throw-site). Dlatego: gdy payload to Error — użyj go wprost;
 * gdy to obiekt niosący string `stack` — zrekonstruuj Error i PRZESZCZEP oryginalny
 * `stack` (+ message z `error`/`message`/`data.message`), by fingerprint szedł po
 * prawdziwym miejscu rzutu; prymityw/brak → fallback na `data.message`.
 */
function toCaptureError(data: ReportIssueProps): Error {
  if (data.payload instanceof Error) {
    return data.payload;
  }
  const record =
    typeof data.payload === 'object' && data.payload !== null
      ? (data.payload as Record<string, unknown>)
      : null;
  const originalMessage =
    record && typeof record.error === 'string'
      ? record.error
      : record && typeof record.message === 'string'
        ? record.message
        : null;
  // Treść wyjątku szła do PostHoga surowa, a komunikaty sklejają adres w zdanie
  // (`Invalid email address: "…"`). Scrub dotykał wyłącznie properties, więc adres
  // trafiał do zewnętrznego subprocesora mimo redakcji obok.
  const error = new Error(
    redactEmailsInText(originalMessage || data.message || 'Backend error')
  );
  if (record && typeof record.stack === 'string' && record.stack.length > 0) {
    error.stack = record.stack;
  }
  return error;
}

/**
 * Most z reportIssueBackend do PostHog. Wywoływany dla KAŻDEGO logu backendu, ale
 * przepuszcza do PostHog tylko error + warn (info zostaje w EventLog):
 *   - 'error' → captureException → event `$exception` (napędza alert emailowy).
 *   - 'warn'  → capture('backend_warning', severity:'warning') → OSOBNY event, żeby
 *     NIE liczył się do progu alertu $exception (startup/seeding warny są normalne
 *     na każdym cold-starcie i zalałyby alert). Widoczne w dashboardzie, opcjonalny
 *     drugi alert.
 *
 * Non-blocking i never-throw: reporting nie może wywalić callera (hot path loggera).
 */
export function captureBackendIssue(data: ReportIssueProps): void {
  if (data.mode !== 'error' && data.mode !== 'warn') {
    return;
  }

  // getPostHogServer() lazily constructs the client on first call — keep it INSIDE
  // the try so a constructor throw can never escape this never-throw last line of
  // defense (reportIssueBackend calls us as its final step; a leak here would
  // propagate into every caller's error path).
  try {
    const posthog = getPostHogServer();
    if (!posthog) {
      return;
    }

    const baseProps = scrub({
      namespace: data.namespace,
      severity: data.mode === 'warn' ? 'warning' : 'error',
      ...payloadToProps(data.payload),
    });

    if (data.mode === 'error') {
      void posthog.captureException(
        toCaptureError(data),
        BACKEND_DISTINCT_ID,
        baseProps
      );
    } else {
      const warnProps: Record<string, unknown> = { ...baseProps };
      if (data.payload instanceof Error) {
        warnProps.error_message = data.payload.message;
        warnProps.error_stack = data.payload.stack ?? null;
      }
      void posthog.capture({
        distinctId: BACKEND_DISTINCT_ID,
        event: 'backend_warning',
        properties: {
          message: redactEmailsInText(data.message),
          ...warnProps,
        },
      });
    }
  } catch {
    // Reporting best-effort — nigdy nie przerywa loggera.
  }
}

// DECISION (nie usuwaj tego komentarza):
// distinctId = userId (Better Auth user.id) — NIE BACKEND_DISTINCT_ID. To ŚWIADOMY,
// odmienny kontrakt niż error/warn (captureBackendIssue): eventy BIZNESOWE (funnel)
// muszą trafić do person-profilu KONKRETNEJ osoby, żeby połączyć się z eventami frontu
// (trial_started → trial_converted → cancel). Kanoniczny klucz osoby w całym systemie to
// user.id: session.userId (endpointy) oraz account.created_by_user_id (webhooki Stripe)
// to ta sama wartość Better Auth. STAN FRONTU (zweryfikowany 2026-08-19): front JUŻ
// identyfikuje — `usePostHogIdentify` (montowany przez `PostHogIdentifyBridge` w
// providerze auth) woła `posthog.identify(user.id, { role_id })` i `reset()` na
// wylogowaniu. Funnel front↔backend jest więc spięty po tym samym kluczu osoby, a
// `person_profiles:'identified_only'` na froncie tylko powstrzymuje tworzenie
// profili dla ruchu anonimowego. (Wcześniejsza wersja tego komentarza twierdziła, że
// front NIE woła identify — to była nieaktualna informacja, nie decyzja projektowa.)
/**
 * Kanał eventów BIZNESOWYCH (user-scoped) — OSOBNY od captureBackendIssue (error/warn).
 * Ten sam klient + gate (IS_PRODUCTION_ENV() && POSTHOG_PROJECT_KEY) co reszta pliku:
 * w dev / bez klucza = no-op. Fire-and-forget, never-throw (best-effort). Properties
 * scrubowane tym samym SECRET_KEY_PATTERN (defense-in-depth, spójnie z error/warn).
 */
export function captureBackendEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  try {
    const posthog = getPostHogServer();
    if (!posthog) {
      return;
    }
    void posthog.capture({
      distinctId,
      event,
      properties: properties ? scrub(properties) : {},
    });
  } catch {
    // best-effort — nigdy nie przerywa callera (side-effect biznesowy).
  }
}

import type { EventLogRecord } from '@kernel/models/db_models.manual.dto';
import {
  getEnvironmentMode,
  IS_DEVELOPMENT_ENV,
} from '@app/environment/environment.utils.api';
import { debuggerStates } from './debugger.state';
import { captureStackTrace, getClientURL } from './debugger.utils.api';
import type { ReportIssueProps } from './error-debugger.types';
import { createEventLogRecord_IO } from './error-handler-io';
import { shouldLogMessage } from './log-rate-limiter';
import {
  getCurrentCorrelationId,
  getCurrentRequestUserId,
} from '@app/http/request-context';
import { serializeErrorLike } from '@kernel/application/error-serialization';
import { captureBackendIssue } from './posthog-server';
import {
  isEmailKey,
  redactEmailValue,
  redactEmailsInText,
} from './pii-redaction';

// DECISION (nie usuwaj tego komentarza):
// Universal sanitizer dla payloadów loggera. Zamienia wartości kluczy z listy
// sekretów na '[REDACTED]', adresy pod kluczami adresowymi na samą domenę, a
// KAŻDY liść tekstowy przepuszcza przez `redactEmailsInText`. Headers, tokens,
// secrety, hasła, klucze API i Stripe signature są scrubbed PRZED JSON.stringify
// → nawet jeśli caller przypadkowo przekaże `req.headers` lub `req.body`, sekrety
// nie wyciekają do EventLog.payload (90d retention).
//
// SCHODZIMY W GŁĄB (2026-09-16), bo „one-level wystarcza dla 99%" było nieprawdą
// w tym 1%, który niesie PII: transport pocztowy loguje `payload: error`
// (magic-link.adapter — Resend/Mailgun/nodemailer), a błąd SMTP ma adresata
// WEWNĄTRZ komunikatu („550 ... <user@x.com>: Recipient address rejected").
// `message` nie jest kluczem adresowym, więc szedł do składu logów dosłownie —
// przy JEDYNEJ ścieżce logowania w produkcie. Klucz zagnieżdżony o poziom niżej
// (`payload: { responseBody: { … } }`) omijał scrub z tego samego powodu.
// To ta sama pułapka, którą opisuje DECISION przy `redactEmailsInText`: payload
// obok był zredagowany, więc rekord WYGLĄDAŁ na czysty.
// Głębokość jest ograniczona (cykle i payloady-potwory), a po jej przekroczeniu
// zwracamy '[TOO_DEEP]', nie surową gałąź — nieprzeskanowane dane nie mają prawa
// wyglądać na przeskanowane.
const SENSITIVE_KEY_REGEX =
  /^(authorization|cookie|set-cookie|x-internal-secret|stripe-signature|token|password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|bearer)$/i;
const REDACTED = '[REDACTED]';

// Redakcja adresów e-mail: klucze i sama funkcja mieszkają w `pii-redaction.ts`
// (jeden zbiór dla OBU pisarzy do składu logów — patrz DECISION w tamtym pliku).
const MAX_REDACTION_DEPTH = 6;

const redactLeaf = (value: unknown): unknown =>
  typeof value === 'string' ? redactEmailsInText(value) : value;

/** Adres albo tablica adresow — jedyne ksztalty, ktore redaguje `redactEmailValue`. */
const isAddressShaped = (value: unknown): boolean =>
  typeof value === 'string' ||
  (Array.isArray(value) && value.every(item => typeof item === 'string'));

/**
 * DECISION (nie usuwaj tego komentarza) — TU NIE MA OBSLUGI `Date`/`Map`/`Set`
 * I NIE MA JEJ CELOWO (zmierzone 2026-09-16):
 * ta funkcja ma DOKLADNIE JEDNO wywolanie i zawsze stoi ZA `serializeErrorLike`
 * (patrz nizej), a jadro normalizuje `Date` do ISO zanim cokolwiek tu dojdzie.
 * Dodalem tu kiedys galaz „Date -> toISOString" razem z testem, ktory mial jej
 * pilnowac — po czym test przeszedl RUWNIEZ PO WYCIECIU tej galezi, bo nie mial
 * jak jej dotknac. Martwy kod plus test, ktory nie umie sie wywrocic na wlasnej
 * klasie regresji, to gorzej niz brak obu: kupuja pewnosc, ktorej nie pokrywaja.
 * Gdyby kiedys `Map`/`Set`/`RegExp` NAPRAWDE trafily do payloadu (dzis zero takich
 * wywolan w repo), naprawa nalezy do `.shared-kernel/application/error-serialization.ts`,
 * bo to ONO jest jedynym miejscem na tej sciezce, ktore te typy widzi.
 */
const redactSensitive = (input: unknown, depth = 0): unknown => {
  if (input === null || typeof input !== 'object') {
    return redactLeaf(input);
  }
  if (depth >= MAX_REDACTION_DEPTH) {
    return '[TOO_DEEP]';
  }
  if (Array.isArray(input)) {
    return input.map(item => redactSensitive(item, depth + 1));
  }
  return redactObject(input as Record<string, unknown>, depth);
};

const redactObject = (
  obj: Record<string, unknown>,
  depth: number
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (SENSITIVE_KEY_REGEX.test(key)) {
      out[key] = REDACTED;
    } else if (isEmailKey(key) && isAddressShaped(value)) {
      // Klucz adresowy redagujemy DO DOMENY (sygnał operacyjny zostaje). Tylko
      // wtedy, gdy wartosc FAKTYCZNIE ma ksztalt adresu — inaczej ta galaz byla
      // dziura w skanie: `emails: [{ to, token }]` wychodzilo nietkniete razem
      // z sekretem w srodku, bo komentarz ZAKLADAL ksztalt, ktorego nikt nie
      // sprawdzal. Niepasujaca wartosc idzie normalna sciezka w glab.
      out[key] = Array.isArray(value)
        ? value.map(redactEmailValue)
        : redactEmailValue(value);
    } else {
      out[key] = redactSensitive(value, depth + 1);
    }
  }
  return out;
};

export const reportIssueBackend = (data: ReportIssueProps): void => {
  if (data.mode === 'info' && !debuggerStates.isEnabledDebugMode) {
    return;
  }

  if (!shouldLogMessage(data.namespace, data.message, data.mode)) {
    return;
  }

  const handledPayload = (): string => {
    if (data.payload instanceof Error) {
      console.error(data.payload);
    }

    switch (typeof data.payload) {
      case 'object':
      default:
        try {
          // DECISION (nie usuwaj tego komentarza):
          // serializeErrorLike PRZED redactSensitive — kolejność jest istotna.
          // Wcześniej `redactSensitive` zwracało instancje Error nietknięte, więc
          // `JSON.stringify` gubiło `message`/`stack` (nieenumerowalne) i jednocześnie
          // NIE redagowało własnych pól błędu. Po normalizacji błąd jest zwykłym
          // obiektem: komunikat przeżywa, a scrub obejmuje także jego pola.
          return JSON.stringify(
            redactSensitive(serializeErrorLike(data.payload))
          );
        } catch {
          return '[Unserializable payload]';
        }
      case 'string':
        // Surowy tekst też bywa nośnikiem adresu (komunikat dostawcy przekazany
        // jako payload), a wcześniej wychodził stąd bez żadnego scrubu.
        return redactEmailsInText(data.payload);
      case 'number':
      case 'boolean':
        return String(data.payload);
      case 'undefined':
        return 'undefined';
    }
  };

  // DECISION (nie usuwaj tego komentarza):
  // Na produkcji stack łapiemy dla mode==='error' (wcześniej: tylko na devie, więc
  // KAŻDY produkcyjny rekord błędu miał `{"callstack":[]}`). Bez stacku i bez
  // komunikatu — patrz serializeErrorLike — wpis w log-store był nieodtwarzalny.
  // Koszt to jeden `new Error()` na ścieżce błędu; info/warn zostają bez stacku,
  // bo to kanał wysokowolumenowy, a nie diagnostyczny.
  const callstack = () => {
    if (IS_DEVELOPMENT_ENV() || data.mode === 'error') {
      return captureStackTrace();
    }
    return [];
  };

  // DECISION (nie usuwaj tego komentarza):
  // event_log_chain_id resolution priority:
  //   1) explicit `data.event_log_chain_id` (caller knows best — e.g. timing
  //      middleware passing its own correlationId directly)
  //   2) AsyncLocalStorage frame set by timing.middleware.ts
  //      (request-context.ts) — covers all in-request callers automatically
  //   3) '0' sentinel for outside-request callers (startup, SIGTERM, cron
  //      sweeps with no request entry) — matches existing system-event marker
  //      used by writeRawEventLog_IO and frontend log ingestion.
  const resolvedChainId =
    data.event_log_chain_id ?? getCurrentCorrelationId() ?? '0';

  const input: Omit<EventLogRecord, 'id' | 'created_at'> = {
    environment: getEnvironmentMode(),
    type: data.mode,
    namespace: data.namespace,
    // `message` też przechodzi redakcję: komunikaty sklejają adres w zdanie, a to
    // pole szło do bazy nietknięte OBOK zredagowanego payloadu — czyli rekord
    // wygladal na czysty, bedac jedynym miejscem z pelnym adresem.
    message: redactEmailsInText(data.message),
    payload: handledPayload(),
    application: 'backend',
    event_log_chain_id: resolvedChainId,
    user_metadata: JSON.stringify({ callstack: callstack() }),
    client_url: getClientURL(),
    user_id: getCurrentRequestUserId() ?? null,
  };

  if (data.mode !== 'info' || debuggerStates.isEnabledDebugMode) {
    console[data.mode](input);
  }

  // DECISION (nie usuwaj tego komentarza) — S113, poprawione po przeglądzie:
  // Tutaj NIE MA sygnału zdrowia i nie należy go tu wstawiać. `createEventLogRecord_IO`
  // tylko dokłada wpis do bufora i wraca — nie jest zapisem do bazy i nie ma ścieżki
  // odrzucenia. Pierwsza wersja czujnika wisiała właśnie na tym wywołaniu i przez to
  // była MARTWA: `markLogSinkWriteFailed` nie mogło się odpalić nigdy, a
  // `markLogSinkWriteSucceeded` strzelało przy każdej linii logu, więc zameldowałoby
  // „powrót zapisów" nad wciąż leżącą bazą. Realny zapis (i jedyne miejsce, gdzie
  // widać jego awarię) siedzi w `runFlush` w `error-handler-io.ts` — czujnik jest
  // wpięty tam.
  void createEventLogRecord_IO(input);

  // PostHog Error Tracking (dochodzi OBOK EventLog — alerting + agregacja stacktrace).
  // Ten sam single-funnel co EventLog, więc process-handlery (instrumentation),
  // throw handlera (request.middleware catch) i operation-failures są pokryte JEDNYM
  // wpięciem — zero podwójnego capture. No-op poza PRODUCTION / bez klucza. Umieszczone
  // PO bramce rate-limit (shouldLogMessage), więc dziedziczy dedup — nie zalewa quoty.
  captureBackendIssue(data);
};

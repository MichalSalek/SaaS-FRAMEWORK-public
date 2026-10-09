import { hasCode } from '@kernel/models/type_narrowing';
import type { DatabaseFailureReason } from '@kernel/application/common-errors.types';
import { isSerializationConflict } from './serialization-conflict';

/**
 * Structural, Turbopack-safe detection of a Prisma known-request error CODE
 * (P2002, P2025, …) — the SSOT predicate for "did this throw carry Prisma code X?"
 * across web-1.
 *
 * DECISION (nie usuwaj tego komentarza) — NIE używaj
 * `error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'X'`:
 * Pod Turbopack (i ogólnie pod bundlerem realizującym ten sam moduł wielokrotnie)
 * `error instanceof Prisma.PrismaClientKnownRequestError` zwraca FALSE mimo że
 * `error.constructor.name === 'PrismaClientKnownRequestError'` — zdublowane tożsamości
 * klasy między realizacjami modułu (DOKŁADNIE ten sam powód, dla którego
 * serialization-conflict.ts unika instanceof). Skutek udowodniony LIVE (round-2
 * concurrency sweep): każdy catch routujący P2002 do gałęzi idempotentnej/gracefulnej
 * przez instanceof PRZESKAKIWAŁ ją i spadał do unmapped 500 GENERAL_ERROR — np.
 * współbieżny session-container/create dla tej samej pary (client, stylist): przegrani
 * wyścigu dostawali 54/100 × 500 zamiast idempotentnego zwycięzcy (201). Sprawdzamy
 * `error.code === code` przez współdzielony `hasCode` narrower (kernel) — czysty
 * structural property-check, odporny na re-wrapping i bundling. Zero `any`/`!`.
 *
 * UWAGA dot. error.meta: `hasCode` zawęża TYLKO do `{ code: string }`. Gdy potrzebujesz
 * `error.meta.target` (dyskryminacja constraintu), NIE polegaj na zawężeniu z instanceof —
 * czytaj meta osobnym structural-guardem (wzór: session-container concurrency.helper
 * `classifyUniqueConstraintViolation` / `readAdapterViolationCause`). Żaden z obecnych
 * konsumentów tego helpera nie czyta meta — wszystkie potrzebują tylko kodu.
 */
export const isPrismaErrorCode = (error: unknown, code: string): boolean =>
  hasCode(error) && error.code === code;

/**
 * Turbopack-safe `P2002` (unique-constraint violation) detector. Convenience over
 * `isPrismaErrorCode(error, 'P2002')` — the by-far most common idempotency/dedup case.
 *
 * Note: the session-container domain keeps its OWN `isP2002` in
 * `domain/session-container/operations/session-container-concurrency.helper.ts`
 * (same structural logic) — a deliberate domain-local copy that sits next to its
 * P2002 constraint classifier (finding session-container-3 lineage). Cross-domain
 * callers use THIS one.
 */
export const isP2002 = (error: unknown): boolean =>
  isPrismaErrorCode(error, 'P2002');

/**
 * Turbopack-safe SQLSTATE `40P01` (Postgres deadlock) detector — the SSOT predicate for
 * "did this throw carry a deadlock?" across web-1. Sibling of `isSerializationConflict`
 * (40001, application/db/serialization-conflict.ts) — same `application/db` home, same
 * adapter-shape reasoning, different SQLSTATE.
 *
 * DECISION (nie usuwaj tego komentarza): 40P01 pod @prisma/adapter-pg NIE jest mapowany na żaden
 * `cause.kind` (zostaje generic DriverAdapterError, w przeciwieństwie do 40001 →
 * `kind: 'TransactionWriteConflict'`). Wychodzi jako `cause.originalCode === '40P01'` (lub
 * top-level `originalCode` / `cause.code`, albo string "deadlock detected ..." w message/stack).
 * To INNY błąd niż 40001 (isSerializationConflict) i niż Prisma known-request P-kody
 * (isPrismaErrorCode). Czyste structural type-narrowing + belt-and-suspenders string-sniff — NIE
 * `instanceof` (Turbopack dubluje tożsamości klas, patrz DECISION przy isPrismaErrorCode powyżej).
 * Zero `any`/`!`.
 *
 * Konsumenci: moderation resolve-report (defence-in-depth → ALREADY_RESOLVED, mod-admin-concurrency
 * helper re-eksportuje to jako isDeadlockError), session-container add-photo
 * (isConcurrencyConflict = isSerializationConflict || isDeadlock) i favorite-remove deadlock-retry
 * (removeRecordFromFavorites_IO — remove vs moderation-DELETE ABBA cycle). JEDEN detektor 40P01 dla
 * całego web-1 (poprzednie lokalne kopie w moderation/session-container skonsolidowane tutaj).
 */
export const isDeadlock = (error: unknown): boolean => {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;

    if (candidate.originalCode === '40P01' || candidate.code === '40P01') {
      return true;
    }

    const cause = candidate.cause;
    if (typeof cause === 'object' && cause !== null) {
      const causeRecord = cause as Record<string, unknown>;
      if (
        causeRecord.originalCode === '40P01' ||
        causeRecord.code === '40P01'
      ) {
        return true;
      }
    }
  }

  if (error instanceof Error) {
    const haystack = `${error.message}\n${error.stack ?? ''}`;
    if (haystack.includes('40P01') || haystack.includes('deadlock detected')) {
      return true;
    }
  }

  return false;
};

/**
 * Turbopack-safe `P2025` (record-not-found on a required write: delete/update where the
 * target row vanished) detector. Convenience over `isPrismaErrorCode(error, 'P2025')` — the
 * idempotent-delete / lost-the-race case (e.g. removeRecordFromFavorites_IO, unbookmarkStylist_IO,
 * concurrent moderation-DELETE won). NIGDY instanceof (patrz DECISION przy isPrismaErrorCode).
 */
export const isP2025 = (error: unknown): boolean =>
  isPrismaErrorCode(error, 'P2025');

/**
 * Turbopack-safe `P2003` (foreign-key constraint violation) detector. Convenience over
 * `isPrismaErrorCode(error, 'P2003')` — the "referenced row does not exist / still referenced"
 * case (e.g. create against a deleted parent, delete of a row with live children).
 */
export const isP2003 = (error: unknown): boolean =>
  isPrismaErrorCode(error, 'P2003');

/**
 * Transient transaction-abort detector — deadlock (SQLSTATE 40P01) OR serialization failure
 * (40001) — the retry-able conflict class for `withWriteTx`. SSOT composite, delegating to the
 * two canonical detectors (zero local logic): `isDeadlock` (40P01, this module) + `isSerializationConflict`
 * (40001, serialization-conflict.ts). Promoted here from session-container-concurrency.helper.ts so
 * every write-tx retry-loop shares ONE transient-conflict predicate (session-container, favorite-remove,
 * gallery-delete ABBA, set-main-policy). NIGDY instanceof.
 */
export const isConcurrencyConflict = (error: unknown): boolean =>
  isSerializationConflict(error) || isDeadlock(error);

const DATABASE_CONNECTIVITY_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1010',
  'P1011',
  'P1017',
  'P2037',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  '57P01',
  '53000',
  '53300',
]);

const DATABASE_CONNECTIVITY_KINDS = new Set([
  'AuthenticationFailed',
  'DatabaseNotReachable',
  'DatabaseAccessDenied',
  'ConnectionClosed',
  'TlsConnectionError',
  'SocketTimeout',
  'TooManyConnections',
]);

const DATABASE_CONNECTIVITY_MESSAGE =
  /(compute|project).{0,80}(suspended|disabled)|suspended.{0,80}(compute|project)|exceeded the compute (?:time )?quota|connection (?:terminated|closed|refused)|database (?:server )?(?:is )?(?:unavailable|unreachable)|too many (?:database )?connections|timeout (?:acquiring|connecting)|getaddrinfo enotfound/i;

/**
 * Structural detector for failures which mean that the primary database cannot
 * currently serve requests. Constraint/validation/concurrency failures are
 * intentionally excluded: they are query failures, not an availability outage.
 *
 * Driver-adapter errors are nested (`DriverAdapterError.cause.*`) and class
 * identity is not reliable under the Next.js bundler, so this follows the same
 * structural rule as the Prisma helpers above.
 */
export const isDatabaseConnectivityError = (error: unknown): boolean => {
  const seen = new Set<object>();
  let candidate: unknown = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== 'object' || candidate === null) {
      return (
        typeof candidate === 'string' &&
        DATABASE_CONNECTIVITY_MESSAGE.test(candidate)
      );
    }
    if (seen.has(candidate)) {
      return false;
    }
    seen.add(candidate);

    const record = candidate as Record<string, unknown>;
    const valuesToCheck = [
      record.code,
      record.originalCode,
      record.kind,
      record.message,
    ];

    for (const value of valuesToCheck) {
      if (typeof value !== 'string') {
        continue;
      }
      if (
        DATABASE_CONNECTIVITY_CODES.has(value) ||
        DATABASE_CONNECTIVITY_KINDS.has(value) ||
        value.startsWith('08') ||
        DATABASE_CONNECTIVITY_MESSAGE.test(value)
      ) {
        return true;
      }
    }

    candidate = record.cause;
  }

  return false;
};

const UNIQUE_CONFLICT_CODES = new Set(['P2002', '23505']);
const REFERENCE_MISSING_CODES = new Set(['P2003', '23503', '23001']);
// P2000 value too long, P2006 invalid value, P2007 data validation, P2020 value out of range.
const INVALID_INPUT_CODES = new Set(['P2000', 'P2006', 'P2007', 'P2020']);

const UNIQUE_CONFLICT_KINDS = new Set(['UniqueConstraintViolation']);
const REFERENCE_MISSING_KINDS = new Set([
  'ForeignKeyConstraintViolation',
  'RestrictViolation',
]);
const INVALID_INPUT_KINDS = new Set([
  'LengthMismatch',
  'InvalidInputValue',
  'ValueOutOfRange',
]);

const classifyCode = (value: string): DatabaseFailureReason | null => {
  if (UNIQUE_CONFLICT_CODES.has(value) || UNIQUE_CONFLICT_KINDS.has(value)) {
    return 'UNIQUE_CONFLICT';
  }
  if (
    REFERENCE_MISSING_CODES.has(value) ||
    REFERENCE_MISSING_KINDS.has(value)
  ) {
    return 'REFERENCE_MISSING';
  }
  // SQLSTATE class 22 = "data exception" (22001 too long, 22003 out of range, 22007/22008
  // bad datetime, 22021 invalid byte sequence e.g. NUL in text, 22P02 bad literal): the
  // statement was well-formed, the VALUE was not — always input, never an outage.
  if (
    INVALID_INPUT_CODES.has(value) ||
    INVALID_INPUT_KINDS.has(value) ||
    /^22[0-9A-Z]{3}$/.test(value)
  ) {
    return 'INVALID_INPUT';
  }
  return null;
};

/**
 * Structural classifier for query failures that are caused by the REQUEST, not by the
 * server: a unique-constraint race (→ 409), a dangling foreign key (→ 400) or a value
 * the database refuses to store (→ 400). Returns `null` for everything else, which stays
 * an opaque 500 (outage, bug, unknown).
 *
 * DECISION (nie usuwaj tego komentarza) — DLACZEGO TA KLASYFIKACJA ISTNIEJE:
 * `databaseFailure` zamieniał KAŻDY wyjątek Prismy na DATABASE_ERROR → 500. testy-api
 * (2026-09-25) znalazł cztery zgodne ze schematem żądania, które tak kończyły: pusty
 * stylist_account_id (P2003), `%00` zdekodowany do NUL (Postgres 22021), liczba jako
 * address_country (PrismaClientValidationError, naprawione w walidatorze) i równoległe edycje junctionów (P2002).
 * Każde z nich naprawiono u źródła, ale 500 przy błędzie wejścia jest kłamstwem wobec
 * klienta (serwer „zepsuty") i fałszywym alarmem w monitoringu — więc ta sieć zamyka CAŁĄ
 * klasę dla przyszłych ścieżek. Miejsce, które ma lepszą, domenową odpowiedź (idempotentny
 * zwycięzca P2002, NOT_FOUND przy P2025, NOT_PAIRED przy P2003), dalej łapie to samo PRZED
 * `databaseFailure` — ta klasyfikacja jest wyłącznie ostatnią linią, nie zamiennikiem.
 * P2011 (NOT NULL) i P2025 świadomie POZA listą: to prawie zawsze błąd naszego kodu albo
 * wyścig, który domena musi nazwać sama. Tak samo `PrismaClientValidationError`: rzuca go
 * i zła wartość z body, i zapytanie źle zbudowane przez NASZ kod (brak wymaganego pola,
 * zły select), a nazwa błędu ich nie rozróżnia — zostaje 500 + `error`, żeby błąd kodu
 * nie zniknął z alertów jako „400 zły input". Dziurę po stronie wejścia zamyka walidator.
 *
 * Kształty (bez `instanceof`, patrz DECISION przy isPrismaErrorCode): top-level `code`
 * (P-kod known-request), `originalCode`/`kind` na DriverAdapterError i w jego `cause`
 * (adapter-pg: SQLSTATE bez P-kodu, np. 22021 → kind 'postgres'), `meta.driverAdapterError`
 * (UserFacingError opakowujący adapter).
 */
export const classifyQueryFailure = (
  error: unknown
): DatabaseFailureReason | null => {
  const seen = new Set<object>();
  const queue: unknown[] = [error];

  while (queue.length > 0 && seen.size < 8) {
    const candidate = queue.shift();
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    const record = candidate as Record<string, unknown>;
    for (const value of [record.code, record.originalCode, record.kind]) {
      if (typeof value !== 'string') {
        continue;
      }
      const reason = classifyCode(value);
      if (reason !== null) {
        return reason;
      }
    }

    queue.push(record.cause);
    const meta = record.meta;
    if (typeof meta === 'object' && meta !== null) {
      queue.push((meta as Record<string, unknown>).driverAdapterError);
    }
  }

  return null;
};

import { hasCode } from '@kernel/models/type_narrowing';
import type { DatabaseFailureReason } from '@kernel/application/common-errors.types';
import { isSerializationConflict } from './serialization-conflict';

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
 * concurrent moderation-DELETE won). NEVER instanceof (see the DECISION at isPrismaErrorCode).
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
 * gallery-delete ABBA, set-main-policy). NEVER instanceof.
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

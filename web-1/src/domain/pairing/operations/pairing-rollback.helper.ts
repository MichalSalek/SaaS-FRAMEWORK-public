/**
 * Sentinel rollback errors for pairing-session transactions.
 *
 * Thrown from inside a Prisma `$transaction` so the whole tx rolls back when a
 * post-write check finds a limit crossed by concurrent requests. The operation
 * catches them in the outer catch and maps them to the matching OperationResult
 * (PAIRING_LIMIT_REACHED / PAIRING_TOO_MANY_ACTIVE_SESSIONS), not DATABASE_ERROR.
 *
 * Same shape as gallery-create.operation.ts: a pre-check fails fast, then a
 * post-write recount throws to roll back, on the default READ COMMITTED isolation
 * rather than raising the transaction to SERIALIZABLE.
 */

/** Klient przekroczył platform-cap MAX_PAIRED_STYLISTS w wyścigu współbieżnych claim. */
export class PairingLimitExceededRollback extends Error {
  constructor(public readonly currentCount: number) {
    super('Pairing limit exceeded');
  }
}

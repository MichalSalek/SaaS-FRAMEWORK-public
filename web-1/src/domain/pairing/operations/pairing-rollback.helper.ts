/**
 * Sentinel rollback errors for pairing-session transactions.
 *
 * Rzucane z wnętrza Prisma `$transaction`, by wymusić rollback całej tx, gdy
 * POST-write verify wykryje przekroczenie limitu w wyścigu współbieżnych żądań.
 * Operacja łapie je w zewnętrznym catch i mapuje na właściwy OperationResult
 * (PAIRING_LIMIT_REACHED / PAIRING_TOO_MANY_ACTIVE_SESSIONS), nie na DATABASE_ERROR.
 *
 * Wzorzec: gallery-create.operation.ts (pre-check fast-fail + post-write recount +
 * throw-to-rollback zamiast SERIALIZABLE — bez ryzyka deadlocku, działa na
 * standardowym Postgres READ COMMITTED).
 */

/** Klient przekroczył platform-cap MAX_PAIRED_STYLISTS w wyścigu współbieżnych claim. */
export class PairingLimitExceededRollback extends Error {
  constructor(public readonly currentCount: number) {
    super('Pairing limit exceeded');
  }
}

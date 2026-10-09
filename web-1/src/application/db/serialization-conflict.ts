import { hasCode } from '@kernel/models/type_narrowing';

/**
 * Detect a PostgreSQL serialization failure (SQLSTATE 40001) surfaced from a
 * Serializable `$transaction`, regardless of how the active Prisma stack wraps it.
 *
 * DECISION (nie usuwaj tego komentarza) — NIE zawężaj tego z powrotem do samego P2034:
 * Pod Prisma 7.x + @prisma/adapter-pg serialization_failure (SQLSTATE 40001) NIE wychodzi
 * jako PrismaClientKnownRequestError z polem `.code === 'P2034'`. Adapter (potwierdzone:
 * @prisma/adapter-pg dist/index.js `case "40001": { kind: "TransactionWriteConflict" }`)
 * rzuca DriverAdapterError, którego:
 *   - `name` === 'DriverAdapterError' (NIE 'TransactionWriteConflict'),
 *   - `cause.kind` === 'TransactionWriteConflict',
 *   - `message` === 'TransactionWriteConflict' (gdy brak osobnego message — patrz
 *     @prisma/driver-adapter-utils: `super(... : payload.kind)`),
 *   - BRAK pola `.code`.
 * Skutek: guard oparty WYŁĄCZNIE na `error.code === 'P2034'` to MARTWY KOD — przegrany
 * wyścigu Serializable (cap/rate-limit loser) leci do databaseFailure → HTTP 500 zamiast
 * intended 429, mimo że tx i tak ROLLBACK-uje (limit trzyma, security OK), ale legit
 * throughput spada pod obciążeniem. Dlatego łapiemy WSZYSTKIE realistyczne kształty:
 *   (a) `.code === 'P2034'`            — klasyczny Prisma error / inne adaptery (binary, libsql),
 *   (b) `.name === 'TransactionWriteConflict'` — gdyby przyszła wersja adaptera tak nazwała error,
 *   (c) `.cause.kind === 'TransactionWriteConflict'` — aktualny kształt adapter-pg (7.x),
 *   (d) message/stack zawiera 'TransactionWriteConflict' lub '40001' — belt-and-suspenders.
 * Defensywnie: zero `any`/`!`, czyste type-narrowing. Helper celowo w web-1 (adapter-specific),
 * NIE w .shared-kernel (kernel nie zna konkretnego sterownika DB).
 */
export function isSerializationConflict(error: unknown): boolean {
  // (a) Classic Prisma known-request error code (other adapters / future re-wrapping).
  if (hasCode(error) && error.code === 'P2034') {
    return true;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as Record<string, unknown>;

    // (b) Top-level error named directly after the conflict kind.
    if (candidate.name === 'TransactionWriteConflict') {
      return true;
    }

    // (c) DriverAdapterError wrapper: the kind lives in `.cause.kind` (adapter-pg 7.x shape).
    const cause = candidate.cause;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      (cause as Record<string, unknown>).kind === 'TransactionWriteConflict'
    ) {
      return true;
    }
  }

  // (d) Last-resort string sniff over message + stack (adapter sets message to the kind,
  // and the raw SQLSTATE 40001 may appear in nested driver errors).
  if (error instanceof Error) {
    const haystack = `${error.message}\n${error.stack ?? ''}`;
    if (
      haystack.includes('TransactionWriteConflict') ||
      haystack.includes('40001')
    ) {
      return true;
    }
  }

  return false;
}

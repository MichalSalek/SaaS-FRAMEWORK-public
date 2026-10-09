import { DB_CLIENT } from '@app/db/db.client';
import { isConcurrencyConflict } from './prisma-error';
import type { Prisma } from '../../prisma/js-client';

/**
 * withWriteTx — ONE canonical bounded-retry wrapper for a write `$transaction`.
 *
 * Consolidates the hand-rolled retry-on-transient-conflict loops (favorite-remove, set-main-policy,
 * gallery-delete ABBA) into a single, parameterized primitive: open an interactive `$transaction`,
 * and on a transient abort (deadlock 40P01 / serialization 40001 by default) re-run the WHOLE
 * callback up to `maxAttempts` times with jittered backoff. Non-retryable errors are rethrown
 * unchanged for the caller to map (P2025 idempotent, business sentinels, etc.).
 *
 * DECISION (nie usuwaj tego komentarza) — KONTRAKT DB-ONLY (krytyczny, /spar cross-model):
 * `fn` MUSI wykonywac WYLACZNIE prace DB. Retry RE-URUCHAMIA caly callback, wiec JAKIKOLWIEK
 * side-effect w srodku (wyslanie email/Stripe/Cloudinary, write event-log POZA tx, mutacja stanu
 * in-memory) zostalby ZDUPLIKOWANY przy ponowieniu. Wszystkie side-effekty rob PO tym jak awaited
 * withWriteTx zwroci (post-commit). Zweryfikowane: 4 istniejace retry-sity sa DB-only.
 *
 * DECISION (nie usuwaj tego komentarza) — retryOn jest PER-CALL, NIE blanket: nie kazdy 40P01/40001
 * znaczy „ponow ten sam zamiar". retryOn domyslnie = isConcurrencyConflict (40P01||40001); call-site
 * moze zawezic (np. tylko isDeadlock dla favorite-remove) lub rozszerzyc. Bledy NIE-retryable
 * (P2025, sentinel biznesowy) sa RETHROWANE — mapuje je catch CALLERA wokol withWriteTx, NIE ten
 * wrapper (zachowanie 1:1 z recznymi petlami). Bogatsza catch-logika per-proba (np. add-photo
 * classify P2002 position/duplicate/active_pair, create-session winner-refetch) ZOSTAJE bespoke w
 * swoich operacjach — withWriteTx celowo NIE probuje jej zabsorbowac (narrow primitive, nie framework).
 */

export type WriteTxOptions = {
  /** Max total attempts (incl. the first). Default 3. */
  maxAttempts?: number;
  /** Postgres isolation level. Default undefined = READ COMMITTED. */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Predicate deciding whether a thrown error is a transient conflict worth retrying. Default isConcurrencyConflict. */
  retryOn?: (error: unknown) => boolean;
  /** Backoff (ms) before the NEXT attempt, given the just-failed attempt number (1-based). Default jitter `attempt*5 + rand[0..9]`. Pass `() => 0` for no-jitter Serializable retries. */
  backoffMs?: (attempt: number) => number;
};

const defaultBackoffMs = (attempt: number): number =>
  attempt * 5 + Math.floor(Math.random() * 10);

export const withWriteTx = async <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: WriteTxOptions = {}
): Promise<T> => {
  const maxAttempts = options.maxAttempts ?? 3;
  const retryOn = options.retryOn ?? isConcurrencyConflict;
  const backoffMs = options.backoffMs ?? defaultBackoffMs;
  const txOptions = options.isolationLevel
    ? { isolationLevel: options.isolationLevel }
    : undefined;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await DB_CLIENT.use.$transaction(fn, txOptions);
    } catch (error) {
      if (attempt < maxAttempts && retryOn(error)) {
        await new Promise<void>(resolve =>
          setTimeout(resolve, backoffMs(attempt))
        );
        continue;
      }
      throw error;
    }
  }
};

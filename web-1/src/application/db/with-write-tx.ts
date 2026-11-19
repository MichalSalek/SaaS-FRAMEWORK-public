import { DB_CLIENT } from '@app/db/db.client';
import { isConcurrencyConflict } from './prisma-error';
import type { Prisma } from '../../prisma/js-client';

/**
 * Bounded retry around one write `$transaction`. A transient abort (deadlock 40P01 or
 * serialization 40001 by default) re-runs the whole callback. Other errors propagate.
 * DECISION: `fn` is database work only. A retry re-runs it, so mail, Stripe, Cloudinary
 * or a log write inside would run twice. Do those after commit. `retryOn` is per call
 * (default isConcurrencyConflict). Richer conflict handling stays in the operation.
 */

export type WriteTxOptions = {
  /** Database-only batches may need more than Prisma's default interactive transaction timeout. */
  timeoutMs?: number;
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
  const txOptions = {
    ...(options.isolationLevel
      ? { isolationLevel: options.isolationLevel }
      : {}),
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
  };

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

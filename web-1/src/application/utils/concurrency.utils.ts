/**
 * Worker pool with bounded concurrency.
 *
 * Worker MUST NOT throw — an unhandled throw rejects the whole pool and
 * leaves remaining items unprocessed. Wrap your worker body in try/catch
 * and return a sentinel value on failure.
 */
export const runWithConcurrency = async <T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  // Shared iterator: .entries() yields [index, item] tuples typed as [number, T]
  // (item stays T, not T | undefined under noUncheckedIndexedAccess), and the
  // single cursor is consumed atomically across the parallel workers below.
  const queue = items.entries();

  const pullNext = async (): Promise<void> => {
    for (const [index, item] of queue) {
      results[index] = await worker(item);
    }
  };

  const poolSize = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: poolSize }, pullNext));
  return results;
};

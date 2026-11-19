/** Serialize cooperating bearer writes across same-origin tabs when Web Locks are available. */
export function withSessionTokenLock<T>(operation: () => T): Promise<T> {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks !== 'undefined'
  ) {
    return navigator.locks.request(
      'nf:session-token',
      { mode: 'exclusive' },
      operation
    );
  }
  // The check and write execute in one synchronous turn; without Web Locks this is not cross-tab atomic.
  return Promise.resolve(operation());
}

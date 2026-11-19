const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

type BucketEntry = {
  count: number;
  suppressedAt: number | null;
  windowStart: number;
};

const buckets = new Map<string, BucketEntry>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60_000;

const cleanup = () => {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS && buckets.size <= 10_000) {
    return;
  }
  lastCleanup = now;
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > WINDOW_MS * 2) {
      buckets.delete(key);
    }
  }
};

export const shouldLogMessage = (
  namespace: string,
  message: string,
  mode?: 'info' | 'warn' | 'error'
): boolean => {
  // DECISION: mode='error' is NOT throttled. During an error storm (DB down, one endpoint failing
  // with the same error) we want FULL visibility of the incident's scale; the rate limit protects
  // against log bloat for info/warn/timing but must not hide the scale of errors exactly when they
  // are critical. Without Redis there is no windowed aggregate, so instead of throttling with signal
  // loss every error log passes (the caller decides: error-handler.ts passes data.mode).
  if (mode === 'error') {
    return true;
  }
  cleanup();

  const key = `${namespace}::${message.slice(0, 100)}`;
  const now = Date.now();
  const entry = buckets.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, suppressedAt: null, windowStart: now });
    return true;
  }

  entry.count++;

  if (entry.count <= MAX_PER_WINDOW) {
    return true;
  }

  if (entry.count === MAX_PER_WINDOW + 1) {
    entry.suppressedAt = now;
    console.warn(
      `[LOG_RATE_LIMIT] Suppressing repeated log: ${namespace} — "${message.slice(0, 80)}..." (>${MAX_PER_WINDOW} in ${WINDOW_MS / 1000}s)`
    );
  }

  return false;
};

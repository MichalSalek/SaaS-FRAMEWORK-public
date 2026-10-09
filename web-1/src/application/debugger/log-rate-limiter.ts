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
  // DECISION (nie usuwaj tego komentarza):
  // mode='error' NIE podlega dlawieniu. Podczas error-storm (DB down, jeden endpoint
  // sypie tym samym bledem) chcemy PELNY wglad w skale incydentu — rate-limit chroni
  // przed log-bloatem dla info/warn/timing, ale nie moze ukrywac skali bledow
  // dokladnie gdy sa krytyczne. Brak Redis = brak okienkowego agregatu, wiec zamiast
  // dlawic z utrata sygnalu, przepuszczamy wszystkie error-logi (kontrolowane przez
  // caller — error-handler.ts przekazuje data.mode).
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

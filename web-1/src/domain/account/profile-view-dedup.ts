/**
 * Profile View Deduplication — In-Memory Store
 *
 * Prevents view count inflation by tracking IP+target combinations.
 * Same IP viewing the same stylist profile within 24h counts as one view.
 *
 * Design:
 * - In-memory Map with TTL (resets on server restart — acceptable for view counts)
 * - Max store size with periodic cleanup (prevents memory leak)
 * - Key: `${ip}:${stylist_account_id}` → ensures per-IP + per-target uniqueness
 * - Follows the same pattern as rate-limit.middleware.ts
 *
 * DECISION (nie usuwaj tego komentarza):
 * `clientIp` MUST be a TRUST-AWARE IP (resolveTrustedClientIp via
 * getKnownRequestHeaders) — NOT the client-supplied `user-metadata.client_ip`
 * header nor a leftmost-XFF value. Those were spoofable, letting an
 * unauthenticated caller rotate the IP to defeat dedup and inflate any stylist's
 * public view_count arbitrarily. The trust contract lives upstream in
 * http.utils.api.ts (getKnownRequestHeaders); this store assumes it holds.
 */

import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

const DEDUP_CONFIG = {
  /** Dedup window: 24 hours in milliseconds */
  WINDOW_MS: TIME.MS_PER_DAY,
  /** Maximum entries before forced cleanup */
  MAX_STORE_SIZE: 50_000,
  /** Periodic cleanup interval: 30 minutes */
  CLEANUP_INTERVAL_MS: 30 * 60 * 1000,
} as const;

/** Timestamp when the view was first recorded */
type ViewRecord = { recordedAt: number };

const viewDedupStore = new Map<string, ViewRecord>();

/**
 * Sentinel IP token used when no trust-aware client IP is available.
 *
 * DECISION (nie usuwaj tego komentarza):
 * When `resolveTrustedClientIp` returns null (no trusted forwarding header AND
 * no socket peer — a rare edge after the socket anchor is wired in
 * http.utils.api.ts), we FAIL CLOSED rather than counting every request. All
 * such IP-less views of a given profile collapse onto ONE shared dedup slot
 * (`__no_ip__:<target>`) per 24h window, mirroring the rate-limiter's shared
 * `'unknown'` fail-closed bucket. This caps the no-IP population at a single
 * view per profile per window — closing the inflation vector — without the
 * opposite failure mode (counting nothing at all if a deployment never exposes
 * a peer). The previous `return true` on null silently disabled dedup entirely.
 */
const NO_IP_SENTINEL = '__no_ip__';

/**
 * Build dedup key from IP and target stylist account ID.
 */
const buildKey = (ip: string, stylistAccountId: string): string =>
  `${ip}:${stylistAccountId}`;

/**
 * Remove expired entries from the store.
 */
const cleanupExpiredEntries = (): void => {
  const now = Date.now();
  const cutoff = now - DEDUP_CONFIG.WINDOW_MS;
  for (const [key, value] of viewDedupStore.entries()) {
    if (value.recordedAt < cutoff) {
      viewDedupStore.delete(key);
    }
  }
};

/**
 * Enforce max store size — cleanup expired first, then FIFO eviction.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Evicts DOWN TO `MAX_STORE_SIZE - 1` (not `MAX_STORE_SIZE`) so that the single
 * `set` the caller performs immediately afterwards lands at exactly
 * `MAX_STORE_SIZE` — never `MAX_STORE_SIZE + 1`. The earlier guards used
 * `<= MAX_STORE_SIZE`, which left no headroom for that add and let the store
 * overshoot the bound by one entry every time it was full.
 *
 * The eviction is BEST-EFFORT FIFO, NOT strict LRU. After a partial
 * `cleanupExpiredEntries()` the Map's insertion order is fragmented (expired
 * keys are removed mid-sequence), so `Array.from(keys())[0..n]` evicts the
 * oldest-INSERTED *surviving* entries — which under churn may not be the
 * oldest by `recordedAt`. That is an accepted trade-off: this is a soft
 * memory cap (view counts reset on restart), not an accuracy-critical cache,
 * so an O(n) sort by timestamp on the hot path is not worth it.
 */
const enforceMaxSize = (): void => {
  // Leave room for the one entry the caller adds next: target a post-add size
  // of at most MAX_STORE_SIZE, i.e. keep the store strictly below the bound.
  if (viewDedupStore.size < DEDUP_CONFIG.MAX_STORE_SIZE) {
    return;
  }

  cleanupExpiredEntries();

  if (viewDedupStore.size < DEDUP_CONFIG.MAX_STORE_SIZE) {
    return;
  }

  // FIFO eviction down to MAX_STORE_SIZE - 1 (see DECISION above).
  const entries = Array.from(viewDedupStore.keys());
  const toDelete = viewDedupStore.size - (DEDUP_CONFIG.MAX_STORE_SIZE - 1);
  for (let i = 0; i < toDelete; i++) {
    const key = entries[i];
    if (key === undefined) {
      break;
    }
    viewDedupStore.delete(key);
  }

  reportIssueBackend({
    namespace: 'PROFILE_VIEW_DEDUP',
    message: `Store overflow — evicted ${toDelete} entries (FIFO)`,
    payload: { storeSize: viewDedupStore.size },
    mode: 'info',
  });
};

// Periodic cleanup (every 30 min)
const CLEANUP_TIMER = setInterval(
  cleanupExpiredEntries,
  DEDUP_CONFIG.CLEANUP_INTERVAL_MS
);
CLEANUP_TIMER.unref?.();

/**
 * Check whether this IP+target combination has already been counted
 * within the dedup window (24h).
 *
 * When `clientIp` is null, all IP-less views of the target share one sentinel
 * bucket (fail-closed — see NO_IP_SENTINEL), so at most one such view counts
 * per profile per window.
 *
 * @returns `true` if the view is NEW (should be counted), `false` if duplicate.
 */
export const shouldCountProfileView = (
  clientIp: string | null,
  stylistAccountId: string
): boolean => {
  // No IP available — fail closed onto a single shared sentinel bucket per
  // target (see NO_IP_SENTINEL DECISION) instead of counting unconditionally.
  const ipToken = clientIp ?? NO_IP_SENTINEL;

  const key = buildKey(ipToken, stylistAccountId);
  const existing = viewDedupStore.get(key);
  const now = Date.now();

  if (existing) {
    // Check if within dedup window
    if (now - existing.recordedAt < DEDUP_CONFIG.WINDOW_MS) {
      return false; // Duplicate — skip
    }
    // Window expired — allow new count
  }

  // Enforce max size BEFORE adding so the `set` below never pushes the store
  // past MAX_STORE_SIZE (enforceMaxSize evicts down to MAX_STORE_SIZE - 1 to
  // reserve the slot — see its DECISION comment).
  if (viewDedupStore.size >= DEDUP_CONFIG.MAX_STORE_SIZE) {
    enforceMaxSize();
  }

  viewDedupStore.set(key, { recordedAt: now });
  return true;
};

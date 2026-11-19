/**
 * In-memory dedup of profile views. The same IP and stylist within 24h count once.
 * The map resets on restart, which is acceptable for view counts, and it caps its size.
 * DECISION: clientIp must be resolveTrustedClientIp. A client-supplied IP or the
 * leftmost X-Forwarded-For value is spoofable and would inflate view_count.
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
 * DECISION: fail closed when no trusted IP is known: all IP-less views of a profile share ONE
 * dedup slot per window (like the rate limiter's 'unknown' bucket). Counting every such request
 * would reopen the inflation vector; counting none would zero views on a deployment without a peer.
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
 * DECISION: evict down to MAX_STORE_SIZE - 1 so the caller's next `set` lands at exactly
 * MAX_STORE_SIZE, never one over. Eviction is best-effort FIFO by insertion order, not strict LRU:
 * this is a soft memory cap for view counts, not worth an O(n) sort on the hot path.
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

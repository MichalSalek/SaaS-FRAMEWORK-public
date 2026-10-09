/**
 * PAIRING CLEANUP STATE (DB-based cross-instance dedup)
 *
 * PostgreSQL advisory lock ensuring only one instance runs cleanup at a time
 * across multi-instance deployments. This is the REAL cross-instance dedup —
 * the per-instance in-memory throttle now lives inside createSweepInterceptor
 * (BDX W4.1) and only reduces unnecessary lock attempts.
 *
 * Advisory lock ID: 7_808_117_001 (fixed, derived from "pairing-cleanup" hash).
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

// Fixed advisory lock ID for pairing cleanup.
// Arbitrary but deterministic — must not collide with other advisory locks.
// Stripe webhooks use md5-based hashes; this uses a fixed numeric constant.
const PAIRING_CLEANUP_LOCK_ID = 7_808_117_001;

/**
 * Try to acquire a PostgreSQL advisory lock for pairing cleanup.
 * Non-blocking: returns immediately with true/false.
 * If another instance holds the lock, returns false — no waiting.
 *
 * DECISION (nie usuwaj tego komentarza): BEST-EFFORT session-level lock. Bliźniaczy lock w
 * webhooku Stripe został USUNIĘTY (2026-08-31) — tam był bezwartościowy po claim-first, a
 * wyciekał RAZ NA EVENT, więc burst/replay groził zapchaniem współdzielonej tablicy locków
 * Postgresa. Tutaj zostaje, bo różnica jest ilościowa i decydująca: ten lock brany jest raz
 * na przebieg sweepa (≈1 na 60 s na instancję), nie raz na zdarzenie, a kolizja kończy się
 * pominięciem rundy, nie odpowiedzią 500 do zewnętrznego dostawcy. NIE kopiuj tego wzorca na
 * ścieżkę per-request ani per-event. Session-level
 * pg_try_advisory_lock + pg_advisory_unlock as two separate $queryRaw calls can land on
 * different pooled backends (PgBouncer) — unlock may miss, leaving the lock held by an idle
 * session until that connection recycles. This is NOT a correctness mechanism and does NOT
 * need pg_advisory_xact_lock (blocking xact-scope is for the per-account serializer in
 * lock-rows.ts; a fire-and-forget idempotent sweep needs non-blocking best-effort dedup). The
 * cleanup is idempotent (deleteMany on already-deleted tokens = 0-affect no-op), so a leaked
 * lock only delays a redundant sweep and self-heals on connection recycle — no correctness
 * impact. The lock only reduces redundant sweeps across instances when it works.
 */
export const tryAcquireCleanupLock = async (): Promise<boolean> => {
  try {
    const result = await DB_CLIENT.use.$queryRaw<
      Array<{ locked: boolean }>
    >`SELECT pg_try_advisory_lock(${PAIRING_CLEANUP_LOCK_ID}::bigint) AS locked`;

    return result[0]?.locked === true;
  } catch (error) {
    reportIssueBackend({
      namespace: 'pairingCleanupLock',
      message: 'Failed to acquire advisory lock',
      payload: error,
      mode: 'error',
    });
    return false;
  }
};

/**
 * Release the PostgreSQL advisory lock for pairing cleanup.
 */
export const releaseCleanupLock = async (): Promise<void> => {
  try {
    await DB_CLIENT.use
      .$queryRaw`SELECT pg_advisory_unlock(${PAIRING_CLEANUP_LOCK_ID}::bigint)`;
  } catch (error) {
    reportIssueBackend({
      namespace: 'pairingCleanupLock',
      message: 'Failed to release advisory lock',
      payload: error,
      mode: 'error',
    });
  }
};

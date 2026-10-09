// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// Korekta 2026-07-19: uptime monitor jest DB-free i NIE jest traffic floorem.
// Sweep planuje się dopiero po zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" w admin /health; >48h = sygnał do oceny external crona.

/**
 * PAIRING CLEANUP INTERCEPTOR
 *
 * Runs once per 24h across ALL instances. Fire-and-forget — doesn't block requests.
 *
 * Flow:
 * 1. In-memory throttle (factory fast-path, avoids DB call on every request)
 * 2. pg_try_advisory_lock (cross-instance dedup, non-blocking — inside `run`)
 * 3. Cleanup expired tokens
 * 4. Release lock (finally)
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1). The
 * advisory lock (true cross-instance dedup) stays in `run` — the factory's throttle
 * is only a per-instance fast-path that reduces redundant lock attempts.
 * Triggered by: HTTP middleware (every request checks, executes if 24h passed).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from './create-sweep-interceptor';
import { cleanupExpiredTokens_IO } from '@domain/pairing/operations/pairing-cleanup.operations';
import {
  tryAcquireCleanupLock,
  releaseCleanupLock,
} from './pairing-cleanup-state';
import { reportIssueBackend } from '@app/debugger/error-handler';

export const pairingCleanupInterceptor = createSweepInterceptor({
  name: 'pairing-cleanup',
  throttleMs: TIME.MS_PER_DAY,
  run: async () => {
    // Cross-instance dedup: try to acquire advisory lock (non-blocking).
    const acquired = await tryAcquireCleanupLock();
    if (!acquired) {
      // Another instance is running cleanup — skip.
      return;
    }

    try {
      const result = await cleanupExpiredTokens_IO();

      if (result.deleted > 0) {
        reportIssueBackend({
          namespace: 'pairingCleanupInterceptor',
          message: `Deleted ${result.deleted} expired pairing sessions`,
          payload: { deleted: result.deleted },
          mode: 'info',
        });
      }
    } finally {
      await releaseCleanupLock();
    }
  },
});

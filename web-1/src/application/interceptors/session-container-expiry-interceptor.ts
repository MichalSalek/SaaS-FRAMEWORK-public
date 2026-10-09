// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron). Świadoma decyzja
// (Wave 3 SC-3): bez tego interceptora expireStaleSessionContainers odpalał się
// TYLKO przy starcie (instrumentation.ts) — na Render (long-running, NIE
// serverless) sesje utworzone po boot nigdy nie EXPIRED w DB. Korekta 2026-07-19:
// DB-free uptime monitor NIE jest traffic floorem; sweep startuje dopiero po
// zaakceptowanym ruchu aplikacji, gdy DB już była potrzebna.
// Monitoring: "last sweep at" exposed via admin /health (sweep-monitoring.utils.ts).
// Startup call zachowany jako warm-up.

// DECISION (nie usuwaj tego komentarza):
// 6h throttle (vs 24h for pairing/event-log cleanup). Tighter window because an
// unswept expired session keeps occupying a stylist quota slot (SC-4 read-side
// filters expires_at, but the count was the gap). 6h bounds worst-case slot
// squat to ≤6h między zaakceptowanymi requestami aplikacji. Sweep cost on a synced
// state = single indexed updateMany matching 0 rows.

/**
 * SESSION CONTAINER EXPIRY INTERCEPTOR
 *
 * Runs once per 6h across ALL instances. Fire-and-forget — doesn't block requests.
 *
 * Flow:
 * 1. In-memory throttle (factory fast-path, avoids DB call on every request)
 * 2. pg_try_advisory_lock (cross-instance dedup, non-blocking — inside `run`)
 * 3. Transition SHARED/ACTIVE sessions past expires_at → EXPIRED
 * 4. Release lock (finally)
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1). The
 * advisory lock (true cross-instance dedup) stays in `run`. Mirrors
 * pairingCleanupInterceptor 1:1 (only the throttle window + lock differ).
 * Triggered by: HTTP middleware (every request checks, executes if 6h passed).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from './create-sweep-interceptor';
import { expireStaleSessionContainers } from '@domain/session-container/session-container.expire-sweep';
import {
  tryAcquireExpiryLock,
  releaseExpiryLock,
} from './session-container-expiry-state';

export const sessionContainerExpiryInterceptor = createSweepInterceptor({
  name: 'session-container-expiry',
  throttleMs: 6 * TIME.MS_PER_HOUR,
  run: async () => {
    // Cross-instance dedup: try to acquire advisory lock (non-blocking).
    const acquired = await tryAcquireExpiryLock();
    if (!acquired) {
      // Another instance is running the sweep — skip.
      return;
    }

    try {
      // expireStaleSessionContainers already reports its own count + swallows
      // its internal errors (returns void).
      await expireStaleSessionContainers();
    } finally {
      await releaseExpiryLock();
    }
  },
});

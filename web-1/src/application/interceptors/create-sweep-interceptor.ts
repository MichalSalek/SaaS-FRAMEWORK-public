/**
 * SWEEP INTERCEPTOR FACTORY (BDX W4.1)
 *
 * Collapses the identical request-interceptor "lazy cron" skeleton that was
 * copy-pasted across 9 sweeps (event-log / ai-crawler / feature-flag / recovery /
 * newsletter / impersonation cleanup + pairing & session-container expiry). Every
 * one had the SAME shape:
 *
 *     if (!shouldAttempt()) return;     // in-memory throttle gate
 *     updateTimestamp();                // mark BEFORE async work (per-instance dedup)
 *     const start = performance.now();
 *     try   { await run(); recordSweepRun(name, dur); }
 *     catch { recordSweepRun(name, dur, err); reportIssueBackend(...); // NEVER throw }
 *
 * The factory owns that skeleton (throttle + timing + recordSweepRun + catch→report,
 * NEVER-throw). The `run` callback keeps FULL reporting freedom — it emits its own
 * success/warn breadcrumbs (stripe warn-escalation, recovery audit-event, etc.); the
 * factory NEVER injects a "what happened" message of its own, only the failure catch.
 *
 * IN-MEMORY THROTTLE: a module-scoped closure `let lastRunAt` replaces the ~6
 * `*-state.ts` files (each was just a `let _ts` + `shouldAttempt`/`updateTimestamp`
 * pair). Per-instance — multi-instance setups run redundantly, which is harmless for
 * idempotent sweeps (deleteMany/updateMany on already-swept rows = 0-affect no-op).
 *
 * CROSS-INSTANCE DEDUP IS NOT THE FACTORY'S JOB: sweeps that need it (pairing &
 * session-container = pg advisory lock; stripe-event-janitor = optimistic row-claim)
 * keep that logic inside their own `run` body / operation. The factory's throttle is
 * a per-instance fast-path ONLY — see each interceptor's DECISION comment.
 *
 * DECISION (nie usuwaj tego komentarza):
 * stripe-event-janitor stays OUT of this factory (its 60s window + cross-instance
 * optimistic-claim semantics + DECISION D1 warrant a documented standalone). It is
 * allowlisted in tests/audit/sweep-interceptor.sh. Every OTHER new `*.interceptor.ts`
 * sweep MUST use this factory (the ratchet enforces it).
 */

import type { SweepName } from '@app/health/sweep-monitoring.utils';
import { recordSweepRun } from '@app/health/sweep-monitoring.utils';
import { reportIssueBackend } from '@app/debugger/error-handler';

type CreateSweepInterceptorConfig = {
  /** Canonical sweep name (SweepName union — must already exist in sweep-monitoring SSOT). */
  name: SweepName;
  /**
   * In-memory throttle window in ms. Build from `TIME.*`
   * (`@kernel/application/constants.config`), e.g. `TIME.MS_PER_DAY`,
   * `6 * TIME.MS_PER_HOUR` — NEVER a raw ms-arithmetic literal (time-literals.sh guards it).
   */
  throttleMs: number;
  /**
   * The sweep body. Owns ALL its own success/warn reporting (the factory does NOT
   * narrate success). May acquire/release a cross-instance lock internally. Thrown
   * errors are caught + reported by the factory (the sweep NEVER blocks the request).
   */
  run: () => Promise<void>;
};

/**
 * Build a fire-and-forget sweep interceptor with a built-in in-memory throttle,
 * sweep-monitoring timing, and a NEVER-throw failure catch.
 *
 * @returns `() => Promise<void>` to wire via `runAfterResponse(...)` in middleware.
 */
export const createSweepInterceptor = ({
  name,
  throttleMs,
  run,
}: CreateSweepInterceptorConfig): (() => Promise<void>) => {
  // Per-instance throttle state (replaces the old `*-state.ts` module `let`).
  let lastRunAt = 0;

  return async (): Promise<void> => {
    // Fast-path: in-memory throttle avoids redundant work on every request.
    if (Date.now() - lastRunAt <= throttleMs) {
      return;
    }

    // Mark BEFORE async work so concurrent requests on THIS instance don't pile in.
    lastRunAt = Date.now();

    const sweepStart = performance.now();

    try {
      await run();
      recordSweepRun(name, Math.round(performance.now() - sweepStart));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      recordSweepRun(
        name,
        Math.round(performance.now() - sweepStart),
        errorMsg
      );
      reportIssueBackend({
        namespace: `${name}-sweep`,
        message: `Sweep "${name}" failed`,
        payload: error,
        mode: 'error',
      });
      // Don't throw — a sweep failure must never block the request.
    }
  };
};

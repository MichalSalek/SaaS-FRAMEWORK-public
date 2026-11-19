/**
 * Run a fire-and-forget task after the response. The handler does not await it.
 * Vercel (`process.env.VERCEL === '1'`) dynamically imports `waitUntil` because
 * `@vercel/functions` is optional. Elsewhere the promise is tracked on globalThis:
 * Next bundles this module separately for instrumentation.ts and pages/api, so a
 * module-level Set left the drain empty. Signature is `Promise<unknown>` in main/ and web-1/.
 */
const globalScope = globalThis as typeof globalThis & {
  __runAfterResponseInFlight?: Set<Promise<unknown>>;
};
const runAfterResponseInFlight = (globalScope.__runAfterResponseInFlight ??=
  new Set<Promise<unknown>>());

export function runAfterResponse(task: () => Promise<unknown>): void {
  if (process.env.VERCEL === '1') {
    void (async () => {
      try {
        const mod = await import('@vercel/functions');
        mod.waitUntil(task());
      } catch {
        void task();
      }
    })();
    return;
  }
  // Non-Vercel (Render): fire-and-forget — the HANDLER still does NOT await,
  // so client latency is unchanged. We only TRACK the promise so graceful
  // shutdown can drain in-flight effects before process.exit on SIGTERM.
  const p = task();
  runAfterResponseInFlight.add(p);
  // `.finally` cleans up the set AND re-throws on rejection, so a failed
  // background task still surfaces to the global 'unhandledRejection' handler
  // (logged in instrumentation.ts), exactly like the previous bare `void task()`.
  void p.finally(() => {
    runAfterResponseInFlight.delete(p);
  });
}

/**
 * Await in-flight `runAfterResponse` effects (bounded) so a graceful shutdown
 * — SIGTERM on every Render redeploy — does not abandon business side-effects
 * (Stripe cancel, audit writes, emails, audience sync, ...) mid-flight.
 * Best-effort: caps at `timeoutMs` so a slow/hung effect never blocks the exit;
 * effects normally settle in <1 s. No-op on Vercel (waitUntil already
 * guarantees completion there, so nothing is tracked in the set).
 */
export async function drainAfterResponseTasks(
  timeoutMs = 10_000,
  quietMs = 1_500
): Promise<number> {
  // DECISION: the server keeps serving during shutdown, so a request still in flight can commit
  // and queue its effect AFTER a one-time snapshot. Watch the set until it has stayed empty for
  // `quietMs` (or the deadline), counting every distinct task seen.
  const deadline = Date.now() + timeoutMs;
  const seen = new Set<Promise<unknown>>();
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    const pending = [...runAfterResponseInFlight];
    if (pending.length === 0) {
      if (Date.now() - quietSince >= quietMs) {
        break;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      continue;
    }
    for (const task of pending) {
      seen.add(task);
    }
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>(resolve =>
        setTimeout(resolve, Math.max(0, deadline - Date.now()))
      ),
    ]);
    quietSince = Date.now();
  }
  // Returns how many effects were drained — the shutdown hook logs this so the
  // FIRST real redeploy after deploy self-verifies the drain (grep
  // PROCESS_SHUTDOWN_DRAIN) and gives ongoing operational visibility.
  return seen.size;
}

/**
 * Run a fire-and-forget task that should complete AFTER the HTTP response
 * is sent, without blocking the response.
 *
 * On Vercel Edge/Serverless: uses `@vercel/functions` `waitUntil` so the
 * platform keeps the function instance alive until the promise settles —
 * guarantees tracking inserts land instead of being abandoned mid-flight.
 *
 * On other runtimes (Render, self-hosted Node, local dev): falls back to
 * a plain floating promise (`void task()`). Best-effort — Node typically
 * completes the promise because event loop stays alive, but no guarantee.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Vercel detection via `process.env.VERCEL === '1'` (set automatically by
 * Vercel build/runtime). `@vercel/functions` declared as optionalDependency
 * so non-Vercel deploys (Render) install without it; dynamic import inside
 * the Vercel branch keeps the helper safe to call from any runtime — the
 * import only resolves when the flag says we're on Vercel.
 *
 * Why not a static import: keeps bundle clean for non-Vercel builds and
 * avoids "Module not found" if the optional dep wasn't installed.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Signature uses `Promise<unknown>` (not `Promise<void>`) intentionally — callers
 * may return values from async tasks and constraining to `void` would force
 * unnecessary casts. Both main/ and web-1/ copies MUST stay in sync on this
 * signature; if you change one, change the other.
 *
 * DURABILITY (nie usuwaj tego komentarza):
 * Na non-Vercel (Render) SIGTERM leci przy KAŻDYM redeploy. Śledzimy odpalone
 * taski w `runAfterResponseInFlight`, żeby `gracefulShutdown` (instrumentation.ts)
 * mógł je DOMKNĄĆ przed `process.exit` zamiast porzucić w locie. Handler NADAL
 * nie awaituje (latencja requestu bez zmian) — czekanie żyje wyłącznie w
 * shutdownie. Drain tylko w web-1 (main = frontend/tracking, brak shutdownu);
 * sygnatura `runAfterResponse` identyczna w obu kopiach (kontrakt sync wyżej).
 */
//
// DECISION (nie usuwaj tego komentarza): the Set lives on globalThis. The drain is
// called from instrumentation.ts and the tasks are added from pages/api, and Next
// bundles this module separately for each, so a module-level Set gave the drain its
// own, always empty copy (testy-api s34; same class as db-availability.state).
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
  // DECISION (nie usuwaj tego komentarza): the server keeps serving during shutdown,
  // so a request still in flight can commit and queue its effect AFTER a one-time
  // snapshot. Watch the set until it has stayed empty for `quietMs` (or the deadline),
  // counting every distinct task seen (closing review s34).
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

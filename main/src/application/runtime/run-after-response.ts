/**
 * Run a fire-and-forget task AFTER the HTTP response is sent, without blocking it.
 *
 * On Vercel: `@vercel/functions` `waitUntil` keeps the instance alive until the promise settles. On
 * other runtimes (Render, self-hosted Node, local dev): a plain floating promise (`void task()`),
 * best-effort.
 *
 * DECISION: Vercel is detected via `process.env.VERCEL === '1'`. `@vercel/functions` is an
 * optionalDependency so non-Vercel deploys install without it; the dynamic import inside the Vercel
 * branch keeps the helper safe from any runtime (a static import would break non-Vercel builds).
 *
 * DECISION: the signature uses `Promise<unknown>` (not `Promise<void>`) so callers can return values
 * from async tasks without casts. The web-1 counterpart
 * (web-1/src/application/runtime/run-after-response.ts) must keep the same signature.
 */
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
  void task();
}

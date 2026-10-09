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

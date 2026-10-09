import { AsyncLocalStorage } from 'node:async_hooks';

// DECISION (nie usuwaj tego komentarza):
// Per-request observability context propagated via Node AsyncLocalStorage
// (Node 16+). Used to auto-inject correlationId (X-Request-Id) into every
// reportIssueBackend() call without modifying ~100+ existing call sites.
//
// WHY AsyncLocalStorage (vs explicit pass-through):
// - Pass-through requires touching every call site (100+ files). One-shot
//   migration cost is fine; ongoing maintenance cost is not — every new
//   reportIssueBackend() call would need to manually thread correlationId
//   through N layers of business logic. ALS makes correlation opt-OUT instead
//   of opt-IN: the chain_id is automatically present unless deliberately
//   overridden.
// - ALS is stdlib in Node 16+, zero deps, native runtime support. Storage is
//   per-async-context (request scope on a serverless invocation), GC'd when
//   the context exits (after res.finish + waitUntil settles).
//
// SCOPE / LIFECYCLE:
// - Context is entered in timing.middleware.ts BEFORE the wrapped handler
//   runs, so every downstream await/Promise chain — including
//   HTTPRequestHandlerMiddleware error path AND runAfterResponse() cleanups
//   that fire post-response — inherits the same correlationId.
// - Context exits when the als.run() callback returns. Inside that callback
//   we await the handler; the handler may schedule background work
//   (runAfterResponse) which captures the ALS frame at scheduling time —
//   that frame remains live for the lifetime of those Promises.
// - Storage holds only a small `RequestContext` object (string id + timestamp).
//   It does NOT retain `req`/`res` references, so there is no leak even if
//   downstream code keeps the correlationId around longer than the request.
//
// FALLBACK (outside-request callers):
// - `getCurrentCorrelationId()` returns `undefined` when called outside any
//   als.run() frame (startup seeding from instrumentation.ts, SIGTERM hooks,
//   cron-style background sweeps with no request entry).
// - Consumers convert undefined → '0' sentinel (matches the existing
//   "system event" marker already used by writeRawEventLog_IO and the
//   frontend log ingestion endpoint).
// - We deliberately do NOT auto-generate a UUID for outside-request calls:
//   that would create singleton "system" log lines that look correlated to
//   nothing, which is more confusing than a clear '0' marker.

export type RequestContext = {
  /** Per-request correlation id (X-Request-Id header). */
  correlationId: string;
  /** Monotonic timestamp when context was entered (ms). */
  startedAtMs: number;
  /**
   * `METHOD /pathname` obsługiwanego żądania — bez query-stringa.
   *
   * DECISION (nie usuwaj tego komentarza):
   * Query jest OBCINANE u źródła (resolveRequestTarget), nie filtrowane później.
   * `req.url` niesie tokeny (`?authCode=`, `?token=`, magic-link), a `client_url`
   * ląduje w AppLogRecord z 90-dniową retencją i jest czytelne w panelu admina.
   * Sama ścieżka wystarcza do diagnozy (endpoint = jednostka błędu), więc nie ma
   * powodu, by sekret w ogóle wchodził do kontekstu.
   */
  requestTarget: string;
  /**
   * Origin + pathname z nagłówka `Referer` (bez query) — dla logów spedytowanych z
   * frontu (`send-log`) to jedyne źródło realnego adresu STRONY, na której błąd
   * wystąpił; `requestTarget` wskazywałby tam tylko na sam endpoint ingestu.
   */
  referer: string | null;
  /**
   * Authenticated user id, filled once the auth middleware has resolved the
   * session. Null until then and for anonymous requests. Mutable on the
   * stored object: the ALS frame is entered in timing middleware, before
   * the user is known.
   */
  userId: string | null;
  /**
   * Lazily resolves the admin impersonating this request's session (null when the
   * session is the user's own). Memoised by the setter; a closure rather than the
   * session token, so the bearer credential never sits in a structure logs read.
   */
  impersonatingAdminId?: () => Promise<string | null>;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` inside a request-scoped ALS frame carrying `ctx`. All synchronous
 * AND asynchronous descendants of `fn` can read the context via
 * `getCurrentCorrelationId()`.
 */
export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => T): T =>
  storage.run(ctx, fn);

/**
 * Get the active correlationId, or `undefined` if no request context is
 * active. Prefer this helper over reading the full context object when only
 * the chain id is needed.
 */
export const getCurrentCorrelationId = (): string | undefined =>
  storage.getStore()?.correlationId;

/**
 * `METHOD /pathname` aktywnego żądania, albo `undefined` poza kontekstem żądania
 * (startup, SIGTERM, sweepy bez wejścia HTTP).
 */
export const getCurrentRequestTarget = (): string | undefined =>
  storage.getStore()?.requestTarget;

/** Adres strony z `Referer` aktywnego żądania (bez query), albo `undefined`. */
export const getCurrentRequestReferer = (): string | undefined =>
  storage.getStore()?.referer ?? undefined;

/** User id of the active request, or undefined outside a request frame. */
export const getCurrentRequestUserId = (): string | null | undefined =>
  storage.getStore()?.userId;

/**
 * Record the authenticated user on the active request frame. No-op outside
 * a request (startup, sweeps). Later logs in the same frame read it back.
 */
export const setCurrentRequestUserId = (userId: string | null): void => {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
};

/**
 * Register how to resolve the impersonating admin for the active request. The
 * lookup runs at most once, and only if something asks (an audit write).
 */
export const setCurrentRequestImpersonationResolver = (
  resolve: () => Promise<string | null>
): void => {
  const store = storage.getStore();
  if (!store) {
    return;
  }
  let pending: Promise<string | null> | undefined;
  store.impersonatingAdminId = () => (pending ??= resolve().catch(() => null));
};

/** Admin impersonating the active request, or null (own session / no request). */
export const getCurrentRequestImpersonatingAdminId = async (): Promise<
  string | null
> => {
  const resolve = storage.getStore()?.impersonatingAdminId;
  return resolve ? resolve() : null;
};

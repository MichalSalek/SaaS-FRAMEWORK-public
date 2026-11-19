import { AsyncLocalStorage } from 'node:async_hooks';

// DECISION: per-request observability context via Node AsyncLocalStorage, so correlationId
// (X-Request-Id) is injected into every reportIssueBackend() call without threading it through
// business logic (correlation is opt-OUT, not opt-IN).
//
// The context is entered in timing.middleware.ts BEFORE the wrapped handler runs, so every
// downstream await chain (error path and runAfterResponse() work included) inherits it. The store
// holds only a small `RequestContext` (id + timestamp), no `req`/`res`, so nothing leaks.
//
// Outside a request `getCurrentCorrelationId()` returns `undefined`; consumers map it to the '0'
// "system event" sentinel. No UUID is generated there: it would correlate to nothing.

export type RequestContext = {
  /** Per-request correlation id (X-Request-Id header). */
  correlationId: string;
  /** Monotonic timestamp when context was entered (ms). */
  startedAtMs: number;
  /**
   * `METHOD /pathname` obsługiwanego żądania — bez query-stringa.
   *
   * DECISION: the query is CUT at the source (resolveRequestTarget), not filtered later.
   * `req.url` carries tokens (`?authCode=`, `?token=`, magic link), and `client_url` lands in
   * AppLogRecord with 90-day retention, readable in the admin panel. The path alone suffices to
   * diagnose (endpoint = unit of error), so the secret never enters the context.
   */
  requestTarget: string;
  /**
   * Origin + pathname from the `Referer` header (no query). For logs forwarded from the
   * frontend (`send-log`) it is the only source of the real PAGE address where the error
   * happened; `requestTarget` would only point at the ingest endpoint.
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

/** Page address from the active request's `Referer` (no query), or `undefined`. */
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

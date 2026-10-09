import type { HTTPErrorCallback, HTTPSuccessCallback } from './http.types';

/**
 * Optional per-call IO options. The `signal` is wired into the underlying
 * fetch via the HTTP adapter — when it aborts, the in-flight request is
 * cancelled. TanStack Query v5 supplies its own signal to `queryFn` for
 * automatic request cancellation on unmount/refocus/staleness — adapters
 * (toPromise) forward it through this channel.
 *
 * `silentBusinessError` — opt-in for best-effort enrichment calls. When set,
 * a business 4xx response (NOT 401, NOT 5xx) fails SOFT: the interceptor still
 * settles the query as a HANDLED TanStack error (isError → the hook falls back
 * to an empty result) and still logs via reportIssueFrontend, but does NOT push
 * a user-facing snackbar. Use for nice-to-have data whose absence must not spam
 * a global error toast (e.g. cross-session photo enrichment on a dangling
 * `session_id`). Per-call (NOT static on the endpoint) because the same IO
 * function is reused by primary-content hooks that DO want the error surfaced.
 */
export type IOClientCallOptions = {
  signal?: AbortSignal;
  silentBusinessError?: boolean;
};

// @Req Request payload
// @Res Response data
// @Err Error payload
export type IOClientFunctionReqResErr<Req, Res, Err> = (
  req: Req,
  successCallback: HTTPSuccessCallback<Res>,
  errorCallback: HTTPErrorCallback<Err>,
  options?: IOClientCallOptions
) => Promise<void>;

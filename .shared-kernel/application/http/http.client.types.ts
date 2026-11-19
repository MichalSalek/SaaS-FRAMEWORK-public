import type { HTTPErrorCallback, HTTPSuccessCallback } from './http.types';

/**
 * Optional per-call IO options. The `signal` is wired into the fetch by the HTTP adapter; aborting
 * it cancels the in-flight request (TanStack Query supplies its own, adapters forward it here).
 *
 * `silentBusinessError`: opt-in for best-effort enrichment calls. A business 4xx (NOT 401, NOT 5xx)
 * fails SOFT: the query settles as a handled TanStack error (isError, the hook falls back to an
 * empty result) and is still logged via reportIssueFrontend, but no snackbar is pushed. Per-call,
 * not static on the endpoint, because the same IO function is reused by primary-content hooks that
 * DO want the error surfaced.
 */
export type IOClientCallOptions = {
  signal?: AbortSignal;
  silentBusinessError?: boolean;
  successFeedback?: SuccessFeedbackOwner;
};

/**
 * Who confirms a SUCCESSFUL response to the person (one owner per outcome).
 * - `event` (default): the event pipeline toasts the response event's text.
 * - `screen`: the screen confirms it itself (its own snackbar with a more
 *   specific text, a saved flash, the result appearing in place); the pipeline
 *   skips only the success toast.
 * - `silent`: nothing confirms it.
 * Errors, cache effects, haptics and redirects are never affected.
 */
export type SuccessFeedbackOwner = 'event' | 'screen' | 'silent';

// @Req Request payload
// @Res Response data
// @Err Error payload
export type IOClientFunctionReqResErr<Req, Res, Err> = (
  req: Req,
  successCallback: HTTPSuccessCallback<Res>,
  errorCallback: HTTPErrorCallback<Err>,
  options?: IOClientCallOptions
) => Promise<void>;

import type { HTTPMethod } from '@kernel/domain/http/http.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export type HTTPErrorFeedbackPolicy = 'foreground' | 'background';

/**
 * Whether a failed request toasts ('foreground') or leaves the feedback to the
 * screen ('background'). An endpoint's declared policy always wins.
 *
 * DECISION: reads owned by the query cache stay silent, actions toast (owner). A GET
 * issued from a TanStack queryFn carries the query's AbortSignal (every queryFn forwards
 * `{ signal }`) and its screen renders `isError` inline, so a toast on top said the same thing twice,
 * and on a background refetch announced a failure the stale content already absorbed. Mutations and
 * imperative GETs (no signal) keep the toast: nothing else tells the user the action failed.
 * 401/403 still reach the event pipeline under 'background' (http.interceptor), so auth redirects
 * are unchanged. A query whose screen shows no inline error opts back in with a declared
 * `errorFeedbackPolicy: 'foreground'`. A forgotten signal costs a duplicate toast, never silence.
 */
export function resolveErrorFeedbackPolicy(
  mode: HTTPMethod,
  declared: HTTPErrorFeedbackPolicy | undefined,
  issuedByQueryCache: boolean
): HTTPErrorFeedbackPolicy {
  if (declared !== undefined) {
    return declared;
  }
  return mode === 'get' && issuedByQueryCache ? 'background' : 'foreground';
}

/**
 * Whether a failed QUERY should still raise the one connectivity toast.
 *
 * DECISION: second-order effect of the silent-reads rule. A screen shows its inline error only
 * when it has nothing to show; when a refetch fails over cached data the stale content stays and
 * the screen says nothing, and the interceptor's INTERNET_CONNECTION_PROBLEM toast was the only
 * hint that the data is old. So it returns for exactly that case: connectivity failure AND data
 * kept. A first-load failure (no data) stays inline only. Business and server errors on a refetch
 * stay silent (no toast storms from polls); Sonner's stable id collapses repeats while visible.
 */
export function shouldAnnounceStaleConnectivity(
  errorEvent: string | null,
  hadData: boolean
): boolean {
  return (
    hadData &&
    errorEvent === APP_EVENTS.INFO.APPLICATION.INTERNET_CONNECTION_PROBLEM
  );
}

// main/src/application/http/queryClient.config.ts
// TanStack Query v5 — QueryClient configuration

import {
  QueryClient,
  MutationCache,
  QueryCache,
  type DefaultOptions,
} from '@tanstack/react-query';
import {
  getUserQueryRetryDelay,
  shouldRetryUserQuery,
} from './user-retry-policy';
import { isIOError } from './toPromise.adapter';
import { shouldAnnounceStaleConnectivity } from './error-feedback.policy';

// DECISION: import-cycle break (madge skipTypeImports). `pushNewSnackbar` is INJECTED through
// `registerGlobalMutationErrorHandler` (wiring in `./queryClient.errorWiring`, imported in
// `_app.tsx`), not imported statically here: that created a value cycle queryClient.config →
// appSnackbar → errorHandler → queryClient.config (errorHandler reads `queryClient.getQueryData` for
// currentUser). queryClient.config is the bootstrap foundation and must not pull the snackbar and
// errorHandler subtree at module init. The registry cuts the edge without changing behaviour: the
// handler is registered at app start, before any mutation can fail.
type GlobalMutationErrorHandler = () => void;
let globalMutationErrorHandler: GlobalMutationErrorHandler | undefined;

/**
 * Wire the global fallback handler fired by `MutationCache.onError` for any
 * mutation WITHOUT `meta.suppressGlobalError`. Called once at bootstrap from
 * `./queryClient.errorWiring` (imported in `_app.tsx`). Kept as registration
 * indirection purely to break the static import cycle described above — the
 * effective behavior is identical to a direct `pushNewSnackbar(...)` call.
 */
export const registerGlobalMutationErrorHandler = (
  handler: GlobalMutationErrorHandler
): void => {
  globalMutationErrorHandler = handler;
};

// DECISION: the global MutationCache.onError is a fallback for hooks without their own error
// handling. A hook with a custom onError MUST set `meta: { suppressGlobalError: true }`, else the
// user sees TWO snackbars; without the fallback mutation failures would be silent.
// A mutation error has three toast layers and only ONE may fire:
//   1 (OWNER): the HTTP interceptor (event-bus). For every failed mutation without
//     `silentBusinessError` it pushes the concrete backend event or INTERNET_CONNECTION_PROBLEM.
//   2 (local onError/catch): allowed ONLY when 1 does not fire: a client-side throw that never
//     passed the interceptor (guard with `if (!isIOError(err))`), or a deliberately silenced
//     interceptor (`silentBusinessError`, `errorFeedbackPolicy:'background'`). NEVER push an event
//     different from the interceptor's: the Sonner `id` dedupes only an IDENTICAL message.
//   3 (global MutationCache.onError): fallback for hooks WITHOUT their own handling;
//     `suppressGlobalError:true` disables only this layer.

// DECISION: only MutationCache.onError is global; read queries handle errors per feature via
// `isError`, because queries decide contextually whether to show fallback UI (empty list vs error
// toast) and a global query snackbar would spam on background refetch failures and retry storms.
// Mutations are always the effect of an explicit user action, so a global snackbar is fine there.

// DECISION: layer 3 skips transport errors. Every `IOError` has passed the interceptor, which
// already decided feedback (pushed a concrete event or deliberately silenced it). Adding
// GENERAL_ERROR here produced a second toast with a different `id` on every mutation without
// `suppressGlobalError` (offline CRM note save: "no connection" + "an error occurred"). Layer 3
// stays a fallback only for exceptions the interceptor never saw.
const mutationCache = new MutationCache({
  onError: (error, _variables, _context, mutation) => {
    if (mutation.meta?.suppressGlobalError === true || isIOError(error)) {
      return;
    }
    globalMutationErrorHandler?.();
  },
});

// Stale data after a failed refetch is the one read failure the screen cannot
// show (it keeps the cached content), so connectivity gets its toast back
// here, once per failure (rationale: shouldAnnounceStaleConnectivity). The
// toast is injected from queryClient.errorWiring, like the mutation fallback
// above, so this bootstrap module imports no snackbar or event-bus code.
let staleConnectivityHandler: (() => void) | undefined;

export const registerStaleConnectivityHandler = (handler: () => void): void => {
  staleConnectivityHandler = handler;
};

// Once per outage: the unread-messages poll (30 s, every app screen) would
// otherwise re-announce the same outage after each toast timeout. The next
// successful query fetch ends the episode.
let staleConnectivityAnnounced = false;

const queryCache = new QueryCache({
  onError: (error, query) => {
    const event = isIOError(error) ? error.httpError.event : null;
    if (
      !staleConnectivityAnnounced &&
      shouldAnnounceStaleConnectivity(event, query.state.data !== undefined)
    ) {
      staleConnectivityAnnounced = true;
      staleConnectivityHandler?.();
    }
  },
  onSuccess: () => {
    staleConnectivityAnnounced = false;
  },
});

const defaultOptions: DefaultOptions = {
  queries: {
    staleTime: 60_000, // 1 min — reduces refetches, better UX on back/forward
    gcTime: 5 * 60_000, // GC after 5 min inactive (decision A18)
    // DD3-F4: previously `retry: false` (no retransmission). Now smart: skip on 4xx-equivalent
    // events (permission/not-found/validation), 1 retry on transient (network, 5xx, timeout).
    // See user-retry-policy.ts for full event blocklist.
    retry: shouldRetryUserQuery,
    retryDelay: getUserQueryRetryDelay,
    refetchOnWindowFocus: false, // Disabled: Capacitor WebView fires focus on app resume, keyboard, notifications — causes burst refetches
  },
  mutations: {
    retry: false,
  },
};

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions,
});

// DECISION: the module singleton above is the BROWSER client only. On the server one Next process
// renders every request, so a shared cache let one request's `initialData` answer the next for
// gcTime (5 min): a public profile rendered stale HTML after an edit and client hydration failed on
// the changed row. `_app` gives each server render a fresh client (TanStack SSR guidance); nothing
// fetches there, so it needs no error-wiring caches.
export const createServerQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions });

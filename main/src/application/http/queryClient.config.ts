// main/src/application/http/queryClient.config.ts
// TanStack Query v5 — QueryClient configuration

import { QueryClient, MutationCache, QueryCache } from '@tanstack/react-query';
import { shouldRetryUserQuery } from './user-retry-policy';
import { isIOError } from './toPromise.adapter';
import { shouldAnnounceStaleConnectivity } from './error-feedback.policy';

// DECISION (nie usuwaj tego komentarza) — import-cycle break (madge skipTypeImports):
// `pushNewSnackbar` jest WSTRZYKIWANY przez `registerGlobalMutationErrorHandler`
// (wiring z `./queryClient.errorWiring`, importowany w `_app.tsx`), a NIE
// importowany statycznie tutaj. Statyczny import tworzył value↔value cykl:
// queryClient.config → appSnackbar → errorHandler → queryClient.config
// (errorHandler czyta `queryClient.getQueryData` po currentUser). queryClient.config
// to fundament bootstrapu (importowany w `_app.tsx`), więc NIE powinien w module-init
// ciągnąć całego poddrzewa snackbar+errorHandler. Indirekcja przez rejestr przecina
// statyczną krawędź bez zmiany zachowania: handler jest zarejestrowany przy starcie
// appki, ZANIM jakakolwiek mutacja może zwrócić błąd.
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

// DECISION (nie usuwaj tego komentarza):
// Globalny MutationCache.onError jest fallbackiem dla hooków bez własnej obsługi błędu.
// Hooki z custom onError (custom message, translated) MUSZĄ dodać `meta: { suppressGlobalError: true }`
// w useMutation config, inaczej user zobaczy DWA snackbary: generic + custom.
// Bez tej linii silent failures w mutations (user nie wie że coś poszło źle) — patrz turbo-review r15 I17.
//
// UWAGA dla przyszłego agenta (NIE usuwaj `suppressGlobalError` z hooków!):
// Błąd mutacji ma TRZY warstwy toasta i tylko JEDNA powinna wystrzelić:
//   Warstwa 1 (WŁAŚCICIEL) — HTTP interceptor (onCatchMainInterceptor → event-bus).
//     Dla KAŻDEJ nieudanej mutacji bez `silentBusinessError` pushuje konkretny event
//     błędu backendu (np. VANITY_URL_ALREADY_EXISTS, VALIDATION_FAILED, GENERAL_ERROR)
//     albo INTERNET_CONNECTION_PROBLEM na sieci/timeoucie. To domyślny właściciel toasta.
//   Warstwa 2 (lokalny onError/catch → pushNewSnackbar) — DOZWOLONA TYLKO gdy warstwa 1
//     NIE zadziała: (a) client-side throw, który nie przeszedł przez interceptor (Stripe
//     SCA, redirect-watchdog) — wtedy GUARD `if (!isIOError(err))`; albo (b) interceptor
//     świadomie wyciszony (`silentBusinessError`, `errorFeedbackPolicy:'background'`,
//     lub event sukcesu w `eventsDisallowedForUI`).
//     NIGDY nie pushuj tu eventu RÓŻNEGO od tego, co pushuje interceptor (frontend-only
//     CANNOT_*, albo przetłumaczony t()-string) — stabilne Sonner `id` deduplikuje tylko
//     IDENTYCZNĄ message, więc inny klucz/string = DWA toasty (turbo-review, klasa S51/S53).
//   Warstwa 3 (ten globalny MutationCache.onError) — generic fallback dla hooków BEZ
//     własnej obsługi. `suppressGlobalError:true` wyłącza TYLKO tę warstwę, nie warstwę 1.
//     Usunięcie go z hooka z własnym pushem = double (generic + specific). To NIE martwy kod.
//
// DECISION (nie usuwaj tego komentarza) — DD-M3:
// Tylko MutationCache.onError jest globalny — read queries handle errors per-feature
// via `isError` state. Powod: queries kontekstowo decyduja czy pokazac fallback UI
// (np. empty list vs error toast). Globalny snackbar dla queries byloby spam-em
// (background refetch failures, retry storms, navigation churn → seria toastow).
// Mutations (user actions) maja jednolity wzorzec — globalny snackbar OK,
// bo to zawsze efekt explicitnej akcji uzytkownika.
//
// DECISION (nie usuwaj tego komentarza) — warstwa 3 pomija błędy transportu:
// każdy `IOError` przeszedł przez interceptor, który JUŻ rozstrzygnął feedback
// (wypchnął konkretny event albo świadomie go wyciszył: silentBusinessError,
// background, eventsDisallowedForUI). Doklejanie tu GENERAL_ERROR dawało drugi
// toast o innym `id` przy każdej mutacji bez `suppressGlobalError` (np. brak sieci
// przy zapisie notatki CRM: „Brak połączenia" + „Wystąpił błąd"). Warstwa 3 zostaje
// więc fallbackiem wyłącznie dla wyjątków, które interceptora nie widziały.
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

export const queryClient = new QueryClient({
  queryCache,
  mutationCache,
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min — reduces refetches, better UX on back/forward
      gcTime: 5 * 60_000, // GC after 5 min inactive (decision A18)
      // DD3-F4: previously `retry: false` (no retransmission). Now smart: skip on 4xx-equivalent
      // events (permission/not-found/validation), 1 retry on transient (network, 5xx, timeout).
      // See user-retry-policy.ts for full event blocklist.
      retry: shouldRetryUserQuery,
      refetchOnWindowFocus: false, // Disabled: Capacitor WebView fires focus on app resume, keyboard, notifications — causes burst refetches
    },
    mutations: {
      retry: false,
    },
  },
});

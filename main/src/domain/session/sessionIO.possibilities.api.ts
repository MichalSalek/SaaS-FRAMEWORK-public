import { defineEndpoint, defineQuery } from '../../application/http/io';
import {
  DEV_ENDPOINTS,
  ENDPOINTS,
} from '../../application/http/http.endpoints';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';

// FDX FAZA 2 (W2.2/W2.3): domena `session` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy call-site).
// Side-effecty po odpowiedzi (cache-patch, setCurrentUser) przeniesione do
// callerów — patrz DECISION w `application/http/io.ts`. Nazwy `_IO` zachowane.

// DECISION (nie usuwaj tego komentarza):
// GET /session/get-all przyjmuje { cursor?, take? } jako query params (backend:
// qStr/qNum z req.query). Zwykły GET (defineEndpoint) NIE serializuje payloadu do
// query stringa — body GET-a jest null. Zeby `take` realnie dotarl do backendu
// uzywamy defineQuery (pattern: pairing, session-container/get-my).
export const getAllSessions_IO = defineQuery<
  SESSION_DTO_API_V1['SESSION_GET_ALL']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE'],
  SESSION_DTO_API_V1['SESSION_GET_ALL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_GET_ALL,
  queryFields: req => ({
    cursor: req?.cursor,
    take: req?.take,
  }),
});

// GET /session/get-current — pure transport for the shared current-user query.
// DECISION (nie usuwaj tego komentarza):
// Side-effects (cache-stamp) live in the caller:
// `UI/shared/hooks/currentUser.query.ts` reads via TanStack Query and gates on
// `hasSessionToken()`. This is the W2.3-correct home for the IO (it was
// previously created locally in UI).
//
// S113: this note used to point at a callback-style legacy variant,
// `sessionGetCurrent_IO` in `sessionIO.operations.api.ts`. Neither the symbol nor
// that file exists any more — this directory holds only the present file, so there
// is no second reader to confuse with the front-door one. What survives under the
// name the old text borrowed is `setCurrentUser`, and it lives somewhere else
// entirely (`application/stores/user-cache.ts`, called from the admin-users IO).
export const getCurrentUser_IO = defineEndpoint<
  SESSION_DTO_API_V1['SESSION_GET_CURRENT']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE'],
  SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_GET_CURRENT,
  mode: 'get',
  // DECISION (nie usuwaj tego komentarza):
  // get-current to BACKGROUND poll tożsamości (odpalany na każdym mountcie shella
  // + refetchach), a NIE akcja użytkownika. Przy utracie łączności (NETWORK/TIMEOUT,
  // np. backend cold-start, realny offline, chwilowy CORS-drift na dev) bez tej flagi
  // KAŻDA nieudana próba pchała globalny snackbar INTERNET_CONNECTION_PROBLEM →
  // flood toastów „Brak połączenia" (interleaving z innymi eventami omijał
  // stare lastSnackbarMemo). Polityka `background` sprawia, że poll faluje SOFT:
  // query rozstrzyga się jako HANDLED error (isError → konsument pokazuje stan
  // połączenia/retry), ZERO snackbara. Wzorzec 1:1 z publicIO / feature-flags /
  // announcements. NETWORK/TIMEOUT i niekrytyczne HTTP nie tworzą per-XHR toasta;
  // realne 401/403 (re-auth/account-state/permission) nadal wyzwalają pipeline.
  errorFeedbackPolicy: 'background',
});

export const deleteSessionExactly_IO = defineEndpoint<
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['RESPONSE'],
  SESSION_DTO_API_V1['SESSION_DELETE_EXACTLY']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_DELETE_EXACTLY,
  mode: 'post',
});

export const deleteSessionAll_IO = defineEndpoint<
  SESSION_DTO_API_V1['SESSION_DELETE_ALL']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_DELETE_ALL']['RESPONSE'],
  SESSION_DTO_API_V1['SESSION_DELETE_ALL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SESSION_DELETE_ALL,
  mode: 'post',
});

// Dev login - bypasses magic link in non-production environments.
// DECISION (nie usuwaj tego komentarza):
// Response typed jako USER_DTO_API_V1['DEV_LOGIN']['RESPONSE'] (= SafeCurrentUser)
// — backend strippuje session.token + session.userId via toSafeCurrentUser przed
// serializacją (web-1/src/pages/api/auth/dev-login/index.ts:240-244). Token
// bearer trafia do klienta WYŁĄCZNIE via Authorization response header
// (setClientHeader) i jest persistowany przez http.interceptor.ts (request side)
// — NIGDY z response body. Wcześniejszy kod czytał `response.data.session.token`
// (dead code po r28 SafeCurrentUser fixie) i powodował fałszywy typescript pass
// bo SafeCurrentUser jest strukturalnym subset CurrentUser.
//
// FDX FAZA 2: zmigrowane na defineEndpoint (czyste transport). Side-effect
// `setCurrentUser(response.data)` przeniesiony do callera (LoginPage
// handleQuickLogin) PRZED refetchSession()/router.push — kolejność 1:1 zachowana
// (cache-stamp przed nawigacją). Custom { email, successCallback, errorCallback }
// API zastąpione promise-first wywołaniem `devLogin_IO({ email })`.
export const devLogin_IO = defineEndpoint<
  USER_DTO_API_V1['DEV_LOGIN']['REQUEST'],
  USER_DTO_API_V1['DEV_LOGIN']['RESPONSE'],
  USER_DTO_API_V1['DEV_LOGIN']['RESPONSE_ERROR']
>({
  url: DEV_ENDPOINTS.DEV_LOGIN,
  mode: 'post',
});

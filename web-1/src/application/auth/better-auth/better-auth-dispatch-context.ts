/**
 * Dostęp do dwóch pól, które Better Auth USTAWIA W RUNTIME na `ctx.context`,
 * ale których NIE DEKLARUJE na typie `AuthContext`.
 *
 * DECISION (nie usuwaj tego komentarza):
 * `returned` i `responseHeaders` są pisane przez hook-runner biblioteki
 * (`better-auth/dist/api/dispatch.mjs`) tuż przed uruchomieniem `hooks.after`:
 *
 *     internalContext.context.returned = result.response;
 *     internalContext.context.responseHeaders = result.headers ?? void 0;
 *
 * Biblioteka deklaruje oba pola WYŁĄCZNIE na swoim wewnętrznym, nieeksportowanym
 * `DispatchContext` (`dist/api/dispatch.d.mts`), a `GenericEndpointContext` niesie
 * goły `AuthContext`, w którym ich nie ma. Do 1.6.25 przechodziło to przez tsc
 * bocznym kanałem strukturalnym; od 1.7.0 `AuthContext` domyka się i tsc słusznie
 * mówi TS2339. Runtime NIE zmienił się ani o jotę — zmierzone na obu wydaniach,
 * a od tej zmiany pilnuje tego strażnik `audit:better-auth-dispatch-contract`,
 * który czyta ZAINSTALOWANY `dispatch.mjs` i wywraca się, gdy któreś przypisanie
 * zniknie. To jest powód, dla którego wolno było odpiąć wersję: jedyne realne
 * ryzyko tej ścieżki było CICHE (funkcja dostaje `undefined` i grzecznie zwraca
 * `null`, a śledzenie nieudanych logowań umiera bez śladu), więc zamieniliśmy je
 * na głośne — bramka pusha, nie niespodzianka na produkcji.
 *
 * Dlatego JEDEN moduł, a nie dwa rzuty w miejscu użycia: przy następnym podbiciu
 * biblioteki jest dokładnie jedno miejsce do sprawdzenia i dokładnie jeden
 * strażnik, który to sprawdzenie wymusza.
 */

import type { GenericEndpointContext } from 'better-auth';

/** Kształt, który hook-runner faktycznie dokłada do `ctx.context`. */
type DispatchRuntimeFields = {
  readonly returned?: unknown;
  readonly responseHeaders?: Headers | undefined;
};

const readDispatchFields = (
  ctx: GenericEndpointContext
): DispatchRuntimeFields => {
  // Jedyny rzut w całym repo na te dwa pola. Uzasadnienie: patrz DECISION wyżej.
  return (ctx.context ?? {}) as DispatchRuntimeFields;
};

/**
 * Wynik endpointu widziany przez `hooks.after`. Na ścieżce błędu jest to
 * instancja `APIError` (better-call opakowuje też `redirect()` jako APIError),
 * na ścieżce sukcesu — ciało odpowiedzi.
 */
export const getDispatchReturned = (ctx: GenericEndpointContext): unknown =>
  readDispatchFields(ctx).returned;

/** Nagłówki odpowiedzi skomponowane przez hook-runner (nośnik `location` przy 302). */
export const getDispatchResponseHeaders = (
  ctx: GenericEndpointContext
): Headers | undefined => readDispatchFields(ctx).responseHeaders;

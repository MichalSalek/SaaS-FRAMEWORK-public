// main/src/application/auth/session-recovery.ts
// When to ask Better Auth for the session again after it came back empty while
// a token is stored.
//
// DECISION (nie usuwaj tego komentarza) — 2026-10-09, zgłoszenie ownera
// z produkcji („jestem klientką? 403 na Polubionych”):
// klient Better Auth pobiera sesję RAZ na załadowanie strony
// (`sessionOptions.refetchOnWindowFocus: false`, zero ponowień w
// `useAuthQuery`). Gdy to jedno pobranie nie dojdzie (chwilowy błąd sieci lub
// backendu, uśpiona baza, token zapisany dopiero po pierwszym pobraniu), atom
// sesji zostaje pusty do odświeżenia strony, a użytkowniczka jest „zalogowana
// bez roli”. Stylistka dostawała wtedy ekran klientki i 403 na jej zapytaniach.
// Ponawiamy więc sami, krótką drabinką, a po jej wyczerpaniu dopiero na sygnał
// z przeglądarki (powrót karty, powrót sieci). Martwy token nie zapętla się:
// pierwsze zwykłe zapytanie dostaje 401 i `auth-token-teardown` usuwa token,
// czyli warunek ponawiania.

/** Delay before retry number `attempt` (0-based); null = the ladder is used up. */
const RECOVERY_DELAYS_MS: readonly number[] = [800, 2_000, 5_000, 12_000];

export function sessionRecoveryDelayMs(attempt: number): number | null {
  return RECOVERY_DELAYS_MS[attempt] ?? null;
}

/** Shortest gap between two retries triggered by a browser signal. */
export const SESSION_RECOVERY_SIGNAL_GAP_MS = 5_000;

export interface SessionRecoveryState {
  /** A session token sits in storage. */
  hasToken: boolean;
  /** The session atom holds a session. */
  hasSession: boolean;
  /** A session request is in flight (first load or a refetch). */
  isFetching: boolean;
  /** Another flow owns the session right now (authCode exchange, the login
   *  confirmation screen): its own refetch follows, ours would race it. */
  isHeldByLoginFlow: boolean;
}

/** True when the app is „logged in without a session” and nobody is fixing it. */
export function needsSessionRecovery(state: SessionRecoveryState): boolean {
  return (
    state.hasToken &&
    !state.hasSession &&
    !state.isFetching &&
    !state.isHeldByLoginFlow
  );
}

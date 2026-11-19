// main/src/application/auth/session-recovery.ts
// When to ask Better Auth for the session again after it came back empty while
// a token is stored.
//
// DECISION: the Better Auth client fetches the session ONCE per page load
// (`sessionOptions.refetchOnWindowFocus: false`, no retries in `useAuthQuery`). When that one fetch
// does not arrive (network or backend blip, sleeping DB, token stored only after the first fetch),
// the session atom stays empty until a reload and the user is "logged in without a role": a
// stylist got the client screen and 403s. So we retry ourselves with a short ladder, then only on
// a browser signal (tab back, network back). A dead token does not loop: the first ordinary request
// gets a 401 and `auth-token-teardown` removes the token, which is the retry condition
// (owner report).

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

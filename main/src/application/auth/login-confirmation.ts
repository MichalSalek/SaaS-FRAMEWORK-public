// main/src/application/auth/login-confirmation.ts
// Login-CSRF gate for the variant-C ?authCode exchange (testy-api s34).
//
// DECISION (nie usuwaj tego komentarza):
// THE ATTACK. A one-time `?authCode` proves that SOMEONE finished a login, not
// that THIS browser started it. An attacker logs in by magic link to his own
// account, stops at the 302 carrying a fresh `?authCode=`, and hands that URL to
// a victim. Exchanging it blindly logs the victim in AS THE ATTACKER, and every
// photo, CRM note and client phone she adds next lands in his account. The
// textbook defence (a state cookie bound to the browser that started the login)
// is unavailable: the product is deliberately zero-cookie (Bearer in
// localStorage, Capacitor WebView; AGENTS.md "Session via Bearer token").
//
// THE FIX (option b, chosen by owner delegation 2026-09-25): every place a login
// starts in this browser stamps a timestamp marker in localStorage. The exchange
// reads the marker and whether a bearer token already exists BEFORE it runs.
// A login this browser did not ask for within the TTL, or one that would replace
// an existing token, stops on a blocking confirmation screen naming the account
// ("Logujesz się jako …") before any of the app mounts. The marker is a HINT,
// not a security boundary: it only skips the question for the common case, and
// a missing or stale marker always falls back to asking.
//
// DECISION (nie usuwaj tego komentarza):
// THE NEW TOKEN STAYS IN MEMORY UNTIL "Tak, to moje konto" (closing review,
// 2026-09-25). The exchange no longer lets the interceptor persist the bearer
// (exchangeAuthCode_IO → captureResponseAuthorization). localStorage is live
// state: a token written there before the answer would be used by a reload or a
// WebView kill (the authCode is already scrubbed, so the gate would not come
// back) and by every other open tab on its next request. So while the screen is
// up the token lives only in the exchanging document (a ref in AuthContext), the
// e-mail for the headline is fetched with it as an EXPLICIT Bearer, "Tak" is the
// only write to storage, and "Nie" revokes the session with the same explicit
// Bearer without ever touching the previous token. Reload without an answer: the
// in-memory token is simply gone and the browser stays in its previous state;
// the orphaned session belongs to whoever minted the link and expires on its own
// (accepted by design, nothing of the victim is in it).

import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { readLocalePrefix } from '@kernel/domain/routing/app-path.utils';

import {
  deleteFromClientStorage,
  getFromClientStorage,
  setToClientStorage,
} from '../client-device-storage/clientStorage.possibilities.api';
import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import { reportIssueFrontend } from '../error-debugger/errorHandler.possibilities.api';
import { bypassLeaveGuard } from '../routing/leave-guard';
import { authClient, signOut } from './better-auth-client';

/** How long a started login counts as "asked for by this browser". */
export const LOGIN_INTENT_TTL_MS = 30 * 60 * 1000;

/** Upper bound for the revoke round-trip on "Nie, to nie ja". */
const REJECT_SIGN_OUT_TIMEOUT_MS = 2500;

/** Stamp "a login was started in this browser now". Call at every login start. */
export function markLoginStarted(now: number = Date.now()): void {
  setToClientStorage({
    key: STORAGE_KEYS.LOGIN_STARTED_AT,
    value: String(now),
  });
}

/** Epoch ms of the last started login, or null when absent or malformed. */
export function readLoginStartedAt(): number | null {
  const raw = getFromClientStorage({ key: STORAGE_KEYS.LOGIN_STARTED_AT });
  if (raw === null || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function clearLoginStarted(): void {
  deleteFromClientStorage({ key: STORAGE_KEYS.LOGIN_STARTED_AT });
}

/**
 * A marker is valid when it exists and is at most LOGIN_INTENT_TTL_MS old. A
 * timestamp from the future (clock moved back, or a hand-edited value) is NOT
 * valid: the gate errs towards asking.
 */
export function isLoginIntentValid(
  startedAt: number | null,
  now: number
): boolean {
  if (startedAt === null) {
    return false;
  }
  const age = now - startedAt;
  return age >= 0 && age <= LOGIN_INTENT_TTL_MS;
}

export interface FreshLoginSignals {
  /** A bearer token was already in storage before the exchange. */
  hadPreviousToken: boolean;
  /** This browser started a login within LOGIN_INTENT_TTL_MS. */
  hadValidMarker: boolean;
}

/**
 * The owner-approved rule: ask whenever the login would replace an existing
 * session (someone else's link must never silently swap an account) or this
 * browser did not start a login recently.
 */
export function needsLoginConfirmation({
  hadPreviousToken,
  hadValidMarker,
}: FreshLoginSignals): boolean {
  return hadPreviousToken || !hadValidMarker;
}

/** Snapshot taken BEFORE the exchange. */
export function captureFreshLoginSignals(
  now: number = Date.now()
): FreshLoginSignals {
  return {
    hadPreviousToken:
      getFromClientStorage({ key: CUSTOM_HEADERS.authorization }) !== null,
    hadValidMarker: isLoginIntentValid(readLoginStartedAt(), now),
  };
}

/** The ONLY place an exchanged token enters storage (with or without the gate). */
export function persistSessionToken(token: string): void {
  setToClientStorage({ key: CUSTOM_HEADERS.authorization, value: token });
}

/** Per-call Better Auth options that send `token` instead of the stored one. */
const explicitBearer = (token: string) => ({
  fetchOptions: { auth: { type: 'Bearer' as const, token } },
});

/**
 * E-mail of the session behind a NOT-yet-persisted token, for the headline.
 * Explicit Bearer (per-call `auth` overrides the client's storage resolver);
 * /get-session does not feed the reactive session atom, so the app's session
 * state is untouched. null on any failure: the screen then asks without it.
 */
export async function fetchPendingLoginEmail(
  token: string
): Promise<string | null> {
  try {
    const { data } = await authClient.getSession(explicitBearer(token));
    return data?.user.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Revoke the unconfirmed session with its own token, sent explicitly. Storage
 * (the previous token, if any) is never touched. Best-effort and bounded: a slow
 * backend delays the reload by at most REJECT_SIGN_OUT_TIMEOUT_MS; a failed
 * revoke leaves only an orphaned session nobody in this browser holds.
 */
export async function revokePendingLogin(token: string): Promise<void> {
  try {
    await Promise.race([
      signOut(explicitBearer(token)),
      new Promise<void>(resolve => {
        setTimeout(resolve, REJECT_SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // best-effort: the token is dropped from memory either way.
  }
  clearLoginStarted();
}

/**
 * Where the document reloads after a rejection, in the language of the current
 * path: back into the app when a previous session is still stored, otherwise
 * the login screen (the state she was in before the link).
 */
export function resolveRejectedLoginTarget({
  pathname,
  hadPreviousSession,
}: {
  pathname: string;
  hadPreviousSession: boolean;
}): string {
  const locale = readLocalePrefix(pathname);
  const target = hadPreviousSession ? ROUTES_FRONT.APP : ROUTES_FRONT.USER_LOG;
  return `${locale ? `/${locale}` : ''}${target}`;
}

/**
 * "Nie, to nie ja", end to end: revoke, record the event (a rejection is a
 * likely login-CSRF attempt, so `warn`, never gated; no PII), then a FULL
 * document reload so the page starts clean from the storage state that was
 * never changed.
 */
export async function rejectFreshLoginAndReload({
  pendingToken,
  hadPreviousSession,
}: {
  pendingToken: string;
  hadPreviousSession: boolean;
}): Promise<void> {
  await revokePendingLogin(pendingToken);
  reportIssueFrontend({
    namespace: 'AUTH_LOGIN_CONFIRM',
    message: 'fresh login rejected by the user (possible login-CSRF link)',
    payload: { hadPreviousSession },
    mode: 'warn',
  });
  bypassLeaveGuard();
  window.location.replace(
    resolveRejectedLoginTarget({
      pathname: window.location.pathname,
      hadPreviousSession,
    })
  );
}

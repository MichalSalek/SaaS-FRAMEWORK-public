// main/src/application/auth/login-confirmation.ts
// Login-CSRF gate for the variant-C ?authCode exchange.
// DECISION: a one-time `?authCode` proves that SOMEONE finished a login, not that THIS browser
// started it: an attacker can hand a victim his own fresh `?authCode=` URL and log her in AS THE
// ATTACKER. A state cookie is unavailable (zero-cookie product), so every login start stamps a
// timestamp marker in localStorage, and the exchange checks the marker and any existing bearer
// token BEFORE it runs. A login this browser did not start within the TTL, or one that would
// replace a token, stops on a blocking confirmation screen ("Logujesz się jako …"). The marker is
// a HINT, not a boundary: a missing or stale marker falls back to asking (owner).
//
// DECISION: the new token stays in MEMORY until "Tak, to moje konto". localStorage is live state:
// a token written before the answer would survive a reload or WebView kill (the authCode is
// already scrubbed) and reach other open tabs. While the screen is up the token lives in a ref in
// AuthContext, the e-mail is fetched with an EXPLICIT Bearer, "Tak" is the only write to storage,
// and "Nie" revokes the session with that Bearer, leaving the previous token untouched.

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
import { withSessionTokenLock } from './session-token-lock';
import {
  credentialsEqual,
  readDocumentCredentials,
  type DocumentCredentials,
} from './document-credentials';

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
export function persistSessionToken(
  token: string,
  allowReplacement = true,
  expectedCurrent?: DocumentCredentials
): Promise<boolean> {
  return withSessionTokenLock(() => {
    const currentCredentials = readDocumentCredentials();
    if (
      expectedCurrent &&
      !credentialsEqual(expectedCurrent, currentCredentials)
    ) {
      return false;
    }
    const current = currentCredentials.authorization;
    if (!allowReplacement && current !== null && current !== token) {
      return false;
    }
    setToClientStorage({ key: CUSTOM_HEADERS.authorization, value: token });
    return true;
  });
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

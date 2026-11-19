// UI/contexts/useSessionRecovery.ts
// Asks Better Auth for the session again when the app is „logged in without a
// session”. Policy and the reason it exists: DECISION in
// application/auth/session-recovery.ts.

import { useCallback, useEffect, useRef } from 'react';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { getFromClientStorage } from '../../application/client-device-storage/clientStorage.possibilities.api';
import {
  SESSION_RECOVERY_SIGNAL_GAP_MS,
  needsSessionRecovery,
  sessionRecoveryDelayMs,
} from '../../application/auth/session-recovery';

const HTTP_UNAUTHORIZED = 401;

function readToken(): string | null {
  return getFromClientStorage({ key: CUSTOM_HEADERS.authorization }) || null;
}

interface SessionRecoveryArgs {
  hasSession: boolean;
  /** `isPending` of `useSession()`: true on first load AND on a refetch that
   *  starts from an empty session. */
  isFetching: boolean;
  /** HTTP status of the last failed session request; null when the last
   *  request succeeded (also when it answered „no session”). */
  errorStatus: number | null;
  /** The last session request failed (network error or a non-2xx answer). */
  hasError: boolean;
  isHeldByLoginFlow: boolean;
  /** Reactive token presence (AuthContext `isLoggedIn`): re-runs the check
   *  when a login flow stamps a token without touching the session atom. */
  isLoggedIn: boolean;
  refetchSession: () => unknown;
}

export function useSessionRecovery({
  hasSession,
  isFetching,
  errorStatus,
  hasError,
  isHeldByLoginFlow,
  isLoggedIn,
  refetchSession,
}: SessionRecoveryArgs): void {
  // Retries since the session was last present.
  const attemptRef = useRef(0);
  const lastTryAtRef = useRef(0);
  // The token that was in storage when the latest session request started. An
  // answer „no session” is final for THAT token only: a token stored after the
  // request left (login in another tab, a stamp channel that did not refetch)
  // has never been asked about.
  const tokenAtRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (isFetching) {
      tokenAtRequestRef.current = readToken();
    }
  }, [isFetching]);

  // A failed request may be retried; an answer is retried only for a token it
  // was not about. 401 is an answer, not a failure.
  const transientFailure = hasError && errorStatus !== HTTP_UNAUTHORIZED;

  const stateRef = useRef({
    hasSession,
    isFetching,
    isHeldByLoginFlow,
    transientFailure,
  });
  stateRef.current = {
    hasSession,
    isFetching,
    isHeldByLoginFlow,
    transientFailure,
  };

  const tryNow = useCallback(() => {
    lastTryAtRef.current = Date.now();
    void refetchSession();
  }, [refetchSession]);

  useEffect(() => {
    if (hasSession) {
      attemptRef.current = 0;
      return;
    }
    const token = readToken();
    const stuck = needsSessionRecovery({
      hasToken: token !== null,
      hasSession,
      isFetching,
      isHeldByLoginFlow,
    });
    if (!stuck) {
      return;
    }
    if (!transientFailure) {
      if (token !== tokenAtRequestRef.current) {
        tryNow();
      }
      return;
    }
    const delay = sessionRecoveryDelayMs(attemptRef.current);
    if (delay === null) {
      return;
    }
    const timer = setTimeout(() => {
      attemptRef.current += 1;
      tryNow();
    }, delay);
    return () => clearTimeout(timer);
  }, [
    hasSession,
    isFetching,
    isHeldByLoginFlow,
    isLoggedIn,
    transientFailure,
    tryNow,
  ]);

  // After the ladder is used up (or for a token that arrived unnoticed) the
  // browser tells us when asking again makes sense.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const onSignal = () => {
      const state = stateRef.current;
      const token = readToken();
      const stuck = needsSessionRecovery({
        hasToken: token !== null,
        hasSession: state.hasSession,
        isFetching: state.isFetching,
        isHeldByLoginFlow: state.isHeldByLoginFlow,
      });
      if (!stuck) {
        return;
      }
      const unasked = token !== tokenAtRequestRef.current;
      if (!state.transientFailure && !unasked) {
        return;
      }
      if (Date.now() - lastTryAtRef.current < SESSION_RECOVERY_SIGNAL_GAP_MS) {
        return;
      }
      attemptRef.current = 0;
      tryNow();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        onSignal();
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CUSTOM_HEADERS.authorization) {
        onSignal();
      }
    };
    window.addEventListener('online', onSignal);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onSignal);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tryNow]);
}

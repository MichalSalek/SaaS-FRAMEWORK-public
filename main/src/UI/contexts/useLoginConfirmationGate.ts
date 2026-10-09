// s34 login-CSRF gate state for AuthProvider: the unconfirmed token held in
// memory, the screen state, and the two answers. Rule, marker and the storage
// contract: application/auth/login-confirmation.ts (DECISIONs there).
import { useCallback, useRef, useState } from 'react';
import {
  fetchPendingLoginEmail,
  persistSessionToken,
  rejectFreshLoginAndReload as rejectAndReload,
} from '../../application/auth/login-confirmation';

export interface LoginConfirmation {
  status: 'pending' | 'confirming' | 'rejecting';
  /** E-mail of the NEW session; null when it could not be fetched. */
  email: string | null;
}

export function useLoginConfirmationGate(
  completeFreshLogin: () => Promise<void>
) {
  const [loginConfirmation, setLoginConfirmation] =
    useState<LoginConfirmation | null>(null);
  // The unconfirmed token lives ONLY here (never React state, never storage)
  // until "Tak, to moje konto". A reload drops it, by design.
  const pendingTokenRef = useRef<string | null>(null);
  const hadPreviousSessionRef = useRef(false);

  const holdForConfirmation = useCallback(
    async (token: string, hadPreviousSession: boolean) => {
      pendingTokenRef.current = token;
      hadPreviousSessionRef.current = hadPreviousSession;
      const email = await fetchPendingLoginEmail(token);
      setLoginConfirmation({ status: 'pending', email });
    },
    []
  );

  // "Tak, to moje konto": the first and only moment the token enters storage.
  // The screen stays up ('confirming') until the session is rehydrated.
  const confirmFreshLogin = useCallback(() => {
    const token = pendingTokenRef.current;
    if (loginConfirmation?.status !== 'pending' || token === null) {
      return;
    }
    pendingTokenRef.current = null;
    setLoginConfirmation({ ...loginConfirmation, status: 'confirming' });
    persistSessionToken(token);
    void completeFreshLogin().finally(() => setLoginConfirmation(null));
  }, [loginConfirmation, completeFreshLogin]);

  // "Nie, to nie ja". The screen stays up ('rejecting') until the full
  // document reload inside rejectAndReload, so nothing of the unwanted account
  // ever mounts, and storage is never written.
  const rejectFreshLoginAndReload = useCallback(() => {
    const token = pendingTokenRef.current;
    if (loginConfirmation?.status !== 'pending' || token === null) {
      return;
    }
    pendingTokenRef.current = null;
    setLoginConfirmation({ ...loginConfirmation, status: 'rejecting' });
    void rejectAndReload({
      pendingToken: token,
      hadPreviousSession: hadPreviousSessionRef.current,
    });
  }, [loginConfirmation]);

  return {
    loginConfirmation,
    holdForConfirmation,
    confirmFreshLogin,
    rejectFreshLoginAndReload,
  };
}

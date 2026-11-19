// Login-CSRF gate state for AuthProvider: the unconfirmed token held in
// memory, the screen state, and the two answers. Rule, marker and the storage
// contract: application/auth/login-confirmation.ts (DECISIONs there).
import { useCallback, useRef, useState } from 'react';
import {
  fetchPendingLoginEmail,
  persistSessionToken,
  rejectFreshLoginAndReload as rejectAndReload,
} from '../../application/auth/login-confirmation';
import { readDocumentCredentials } from '../../application/auth/document-credentials';

export interface LoginConfirmation {
  status: 'pending' | 'confirming' | 'rejecting';
  /** E-mail of the NEW session; null when it could not be fetched. */
  email: string | null;
  retryRequired?: boolean;
}

export function useLoginConfirmationGate(
  completeFreshLogin: (token: string) => Promise<void>
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
    const expectedCurrent = readDocumentCredentials();
    setLoginConfirmation({ ...loginConfirmation, status: 'confirming' });
    void persistSessionToken(token, true, expectedCurrent)
      .then(async saved => {
        if (!saved) {
          setLoginConfirmation({
            ...loginConfirmation,
            status: 'pending',
            retryRequired: true,
          });
          return;
        }
        await completeFreshLogin(token);
        pendingTokenRef.current = null;
        setLoginConfirmation(null);
      })
      .catch(() => {
        setLoginConfirmation({
          ...loginConfirmation,
          status: 'pending',
          retryRequired: true,
        });
      });
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

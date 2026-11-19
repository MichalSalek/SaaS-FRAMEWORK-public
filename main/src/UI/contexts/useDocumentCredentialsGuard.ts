import { useEffect, useLayoutEffect } from 'react';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import {
  checkedDocumentCredentials,
  DOCUMENT_CREDENTIAL_MISMATCH,
  readDocumentCredentials,
} from '../../application/auth/document-credentials';
import { bypassLeaveGuard } from '../../application/routing/leave-guard';

const useBrowserLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;
const reloadPage = () => window.location.reload();
/** Revoke tears down locally; replacement drops the old UI and preserves the new bearer. */
export function useDocumentCredentialsGuard({
  loginBlocked,
  clearIdentityState,
  localLogoutTeardown,
  reload = reloadPage,
}: {
  loginBlocked: boolean;
  clearIdentityState: (clearPersistent?: boolean) => void;
  localLogoutTeardown: (expected: string | null) => Promise<void>;
  reload?: () => void;
}) {
  useBrowserLayoutEffect(() => {
    const replace = () => {
      if (loginBlocked) {
        return;
      }
      if (readDocumentCredentials().authorization === null) {
        void localLogoutTeardown(null);
        return;
      }
      clearIdentityState(false);
      bypassLeaveGuard();
      reload();
    };
    window.addEventListener(DOCUMENT_CREDENTIAL_MISMATCH, replace);
    if (!loginBlocked) {
      checkedDocumentCredentials();
    }
    return () =>
      window.removeEventListener(DOCUMENT_CREDENTIAL_MISMATCH, replace);
  }, [loginBlocked, clearIdentityState, localLogoutTeardown, reload]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CUSTOM_HEADERS.authorization || loginBlocked) {
        return;
      }
      if (readDocumentCredentials().authorization === null) {
        void localLogoutTeardown(null);
      } else {
        checkedDocumentCredentials();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [loginBlocked, localLogoutTeardown]);
}

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';
import { deriveAccountRecoveryState } from '../../features/account/helpers/account-recovery-state.helper';

interface UseRecoveryGuardArgs {
  currentUser: SafeCurrentUserWire | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isAdmin: boolean;
  isBecomeUser: boolean;
}

export function useRecoveryGuard({
  currentUser,
  isLoading,
  isFetching,
  isAdmin,
  isBecomeUser,
}: UseRecoveryGuardArgs): void {
  const router = useRouter();
  const recoveryState = deriveAccountRecoveryState(currentUser);
  useEffect(() => {
    // Never act on a loading/refetching snapshot.
    if (isLoading || isFetching) {
      return;
    }
    // Admins / active impersonation are exempt — they may legitimately view a
    // soft-deleted target while impersonating; /recover would be the wrong (and
    // destructive) surface for them.
    // useAppRole reads this token in an effect. A cached account can already be
    // recoverable on the first commit, before that state update reaches us.
    const becomeToken = getFromClientStorage({
      key: CUSTOM_HEADERS.becomeUser,
    });
    if (
      isAdmin ||
      isBecomeUser ||
      (becomeToken !== null && becomeToken !== '')
    ) {
      return;
    }
    if (recoveryState === 'active') {
      return;
    }
    if (router.pathname === ROUTES_FRONT.USER_RECOVER) {
      return;
    }
    void runInstant(
      'recovery-guard',
      () => router.replace(ROUTES_FRONT.USER_RECOVER),
      ROUTES_FRONT.USER_RECOVER
    );
  }, [recoveryState, router, isAdmin, isBecomeUser, isLoading, isFetching]);
}

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import { deriveAccountRecoveryState } from '../../features/account/helpers/account-recovery-state.helper';

interface UseRecoveryGuardArgs {
  currentUser: SafeCurrentUser | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isAdmin: boolean;
  isBecomeUser: boolean;
}

/* ── Recovery routing guard (ADRR Model A §13.1) ──
 * DECISION (nie usuwaj tego komentarza):
 * Soft-deleted users keep valid credentials, so a RECOVERABLE/EXPIRED user can
 * still log in and land on /app/*. This guard is the FRONTEND UX mirror of the
 * backend security boundary (B3): it routes such users to the restore screen so
 * they cannot wander the app while soft-deleted. The backend remains the real
 * boundary (this is only a redirect, not a permission). The recover route is
 * excluded so the restore screen itself is reachable.
 *
 * Admin/impersonation bypass (mirror onboarding guard `role !== 'admin'`): an
 * admin impersonating a soft-deleted target (become-user) has currentUser =
 * target → recoveryState = recoverable/expired. WITHOUT this bypass the admin
 * would be force-replaced onto the target's /recover screen (reactivate +
 * GDPR-erase buttons = destructive mis-click surface). Skip the redirect for
 * admins / active impersonation — switch-back/refresh stay reachable (backend
 * allowlist IMPERSONATION_EXIT permits act/exit).
 *
 * Load-safety (mirror onboarding guard): gate on !isLoading && !isFetching so
 * the guard never acts on a transient/stale currentUser snapshot mid-fetch.
 * deriveAccountRecoveryState(undefined) returns 'active' so the redirect cannot
 * fire before data resolves, but the explicit gate makes intent symmetric with
 * the onboarding guard and robust to future state-default changes.
 *
 * Inputs arrive as PARAMETERS (currentUser + auth-derived flags) — the hook does
 * NOT call useCurrentUserAccount/useAppRole again, so it cannot re-subscribe or
 * drift from AppLayout's single read. recoveryState is derived inside. */
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
    if (isAdmin || isBecomeUser) {
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

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';
import { hasResolvedStylistPlan } from '../../shared/onboarding-plan.helpers';

import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';
import {
  deriveAccountRecoveryState,
  type AccountRecoveryState,
} from '../../features/account/helpers/account-recovery-state.helper';
import { readPrefilledRole } from '../../features/auth/onboarding.helpers';

interface UseOnboardingPlanGuardArgs {
  currentUser: SafeCurrentUserWire | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isSessionPending: boolean;
  isAdmin: boolean;
  isBecomeUser: boolean;
}

/** Why the gate fired — surfaced as the runInstant reason (diagnostics only). */
export type OnboardingGateReason = 'no-account' | 'plan-unresolved';

/** Pure decision output for the app-wide onboarding gate. */
export type OnboardingGateDecision =
  | { kind: 'redirect'; target: string; reason: OnboardingGateReason }
  /** Nothing to do: still loading, exempt, already resolved, or excluded route. */
  | { kind: 'none' };

/** Minimal account-presence view of the current user the decision needs. */
type CurrentUserAccounts = Pick<
  SafeCurrentUserWire,
  'stylist_account' | 'client_account'
>;

interface OnboardingGateInputs {
  /** `router.pathname` — internal Next path (no locale prefix, no query). */
  pathname: string;
  /** `router.query` — the `?role=` hint is forwarded to onboarding if valid. */
  query: Record<string, string | string[] | undefined>;
  /** `undefined` while the account query has not delivered a user yet. */
  currentUser: CurrentUserAccounts | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isSessionPending: boolean;
  isAdmin: boolean;
  isBecomeUser: boolean;
  /** Synchronous become-user token read (first-render race belt, see hook). */
  isImpersonatingSync: boolean;
  /** `deriveAccountRecoveryState(currentUser)` — non-'active' is exempt. */
  recoveryState: AccountRecoveryState;
  /** Has the stylist consciously resolved a plan? Irrelevant without one. */
  planResolved: boolean;
}

/** Onboarding target with the validated `?role=` hint carried over (if any). */
function onboardingTarget(
  query: Record<string, string | string[] | undefined>
): string {
  // H-FUNNEL: forward a validated ?role hint if it rode in via /app, so the
  // onboarding role step stays pre-selected (role = UX hint only, never authz).
  const prefilledRole = readPrefilledRole(query);
  return prefilledRole
    ? `${ROUTES_FRONT.ONBOARDING}?role=${prefilledRole}`
    : ROUTES_FRONT.ONBOARDING;
}

/**
 * Resolve WHETHER (and why) the current /app route must bounce to onboarding.
 * Pure and exported for unit tests — the hook below owns the side-effect only.
 * Ordering of the checks mirrors the DECISION block on the hook: settle → exempt
 * identities → recovery → route allowlist → no-account → plan-unresolved.
 */
export function resolveOnboardingGateDecision({
  pathname,
  query,
  currentUser,
  isLoading,
  isFetching,
  isSessionPending,
  isAdmin,
  isBecomeUser,
  isImpersonatingSync,
  recoveryState,
  planResolved,
}: OnboardingGateInputs): OnboardingGateDecision {
  // Never act on a loading / refetching / session-pending snapshot — the gate
  // must not fire on a skeleton (see TIMING in the DECISION block).
  if (
    isLoading ||
    isFetching ||
    isSessionPending ||
    currentUser === undefined
  ) {
    return { kind: 'none' };
  }
  if (isAdmin || isBecomeUser || isImpersonatingSync) {
    return { kind: 'none' };
  }
  if (recoveryState !== 'active') {
    return { kind: 'none' };
  }
  const onExcludedRoute =
    pathname === ROUTES_FRONT.ONBOARDING ||
    pathname === ROUTES_FRONT.USER_RECOVER ||
    pathname === ROUTES_FRONT.CHECKOUT_RETURN;
  if (onExcludedRoute) {
    return { kind: 'none' };
  }
  const hasStylistAccount = currentUser.stylist_account !== null;
  const hasClientAccount = currentUser.client_account !== null;
  if (!hasStylistAccount && !hasClientAccount) {
    return {
      kind: 'redirect',
      target: onboardingTarget(query),
      reason: 'no-account',
    };
  }
  if (hasStylistAccount && !planResolved) {
    return {
      kind: 'redirect',
      target: ROUTES_FRONT.ONBOARDING,
      reason: 'plan-unresolved',
    };
  }
  return { kind: 'none' };
}

/* ── App-wide onboarding guard (no-account + mandatory-plan) ──
 * DECISION: two "must finish onboarding" cases are gated from ANYWHERE in /app (mounted once
 * in AppLayout), so a deep link to a profile screen does not hit 404 CLIENT_NOT_FOUND:
 *   1. NO ACCOUNT: neither stylist_account nor client_account. The `?role=` hint is forwarded.
 *   2. PLAN UNRESOLVED: a stylist_account whose plan was never resolved, see `planResolved`
 *      (kernel CAN_USER_HAVE_ACTIVE_ACCOUNT plus subscription and admin override tolerances).
 * Exempt: client-only users; admin and impersonation (`isImpersonatingSync` covers the
 * first-render race); a non-'active' recovery state, owned by useRecoveryGuard (else the two
 * guards ping-pong /recover and /onboarding).
 * DUAL-ROLE: the plan gate fires even with a client_account too; resolving costs one tap (Free).
 * Excluded routes: ONBOARDING (loop), USER_RECOVER, CHECKOUT_RETURN (the webhook can lag the
 * return). USER_ACCOUNT_PAY is NOT excluded: onboarding has the same panel.
 * TIMING: act only when the account query and the session are settled; a stale "no accounts"
 * snapshot would bounce a freshly onboarded user, a pending role could mis-gate an admin. */
export function useOnboardingPlanGuard({
  currentUser,
  isLoading,
  isFetching,
  isSessionPending,
  isAdmin,
  isBecomeUser,
}: UseOnboardingPlanGuardArgs): void {
  const router = useRouter();
  const redirectFired = useRef(false);

  const planResolved = hasResolvedStylistPlan(currentUser);

  const recoveryState = deriveAccountRecoveryState(currentUser);

  // Belt-and-suspenders for the isBecomeUser first-render race: useAppRole reads the
  // become-user token in an effect, so on a cache-warm first render isBecomeUser is
  // still false and an impersonating admin could be bounced before it lands (/spar).
  // Read the token SYNCHRONOUSLY here too (getFromClientStorage is SSR-safe → null
  // server-side; consumed only in the effect-gated redirect → no hydration mismatch).
  const becomeToken = getFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
  const isImpersonatingSync = becomeToken !== null && becomeToken !== '';

  const decision = resolveOnboardingGateDecision({
    pathname: router.pathname,
    query: router.query,
    currentUser,
    isLoading,
    isFetching,
    isSessionPending,
    isAdmin,
    isBecomeUser,
    isImpersonatingSync,
    recoveryState,
    planResolved,
  });
  const target = decision.kind === 'redirect' ? decision.target : null;
  const reason = decision.kind === 'redirect' ? decision.reason : null;

  useEffect(() => {
    if (target === null || reason === null || redirectFired.current) {
      return;
    }
    redirectFired.current = true;
    void runInstant(
      `onboarding-plan-guard:${reason}`,
      () => router.replace(target),
      target
    );
  }, [target, reason, router]);
}

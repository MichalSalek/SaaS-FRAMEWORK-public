import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import type { SafeCurrentUser } from '@kernel/models/session/session.dto';
import { USER_POLICY } from '@kernel/policies/user.policy';

// Subscription statuses that represent a REAL engaged plan a REDIRECT must not
// undo (billing/dunning surfaces own their recovery, not onboarding). Deliberately
// EXCLUDES INCOMPLETE_EXPIRED / CANCELED / UNPAID / PAUSED: for those the backend
// resets pricing_plan=FREE + account_status=NOT_ACTIVE (no paid access), so an
// abandoned 3DS/payment-fail must fall through to the plan gate — a bare
// `subscription_status != null` check let INCOMPLETE_EXPIRED bypass it (/spar).
const ENGAGED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  SubscriptionStatusValue.ACTIVE,
  SubscriptionStatusValue.TRIALING,
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.INCOMPLETE,
]);
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { runInstant } from '../../../application/routing/navigation.possibilities.api';
import { getFromClientStorage } from '../../../application/client-device-storage/clientStorage.possibilities.api';
import {
  deriveAccountRecoveryState,
  type AccountRecoveryState,
} from '../../features/account/helpers/account-recovery-state.helper';
import { readPrefilledRole } from '../../features/auth/onboarding.helpers';

interface UseOnboardingPlanGuardArgs {
  currentUser: SafeCurrentUser | undefined;
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
  SafeCurrentUser,
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
 * DECISION (nie usuwaj tego komentarza):
 * TWO orthogonal "must finish onboarding" cases are gated here, app-wide, from
 * ANYWHERE in /app (this hook is mounted once in AppLayout):
 *
 *   1. NO ACCOUNT (stylist_account === null && client_account === null) — a user
 *      who completed magic-link auth but never finished onboarding. Until the
 *      prod incident of 2026-09-02 this case was covered ONLY by
 *      DashboardPage.useOnboardingGuard, i.e. the redirect fired only when the
 *      user happened to land on the dashboard. A `role_client` user without a
 *      ClientAccount row who opened /app/client-profile straight from the drawer
 *      got `GET /api/v1/client/profile` → 404 CLIENT_NOT_FOUND → the profile
 *      ERROR screen instead of onboarding. Same semantics as the dashboard guard
 *      (settled data, admin exempt, validated `?role=` hint forwarded), now
 *      route-independent. The dashboard guard stays as a belt (documented there).
 *
 *   2. PLAN UNRESOLVED — a stylist who HAS a `stylist_account` but has NOT
 *      consciously RESOLVED a plan (e.g. slipped past the plan step via
 *      avatar-drawer → Panel) must be forced back to onboarding.
 *
 * "resolved" = kernel SSOT USER_POLICY.CAN_USER_HAVE_ACTIVE_ACCOUNT
 * (payment_status === PAID  OR  pricing_plan === FREE && plan_selected_at != null)
 * PLUS two redirect-only tolerances — subscription_status != null (ever subscribed,
 * incl. dunning/canceled) and admin_plan_override === true (comped). Full rationale
 * inline at the `planResolved` computation. Verified against the dev DB: seeded/demo
 * PRO stylists are payment_status=PAID with NO live Stripe subscription, so keying
 * off payment_status (not subscription_status, which was the earlier bug) is what
 * prevents the ~712/723 false-positive lockout. web-1 no longer sets plan_selected_at
 * optimistically at checkout mint, so an ABANDONED paid checkout (pricing_plan stays
 * FREE, plan_selected_at null) is correctly UNRESOLVED.
 *
 * EXEMPTIONS (both cases):
 *   • Client-only user (client_account set, no stylist_account) → nothing to
 *     resolve (clients have no plan concept) and nothing missing.
 *   • Admin / active impersonation (become-user) → bypass, mirroring
 *     useRecoveryGuard: an admin inspecting or impersonating a user must not
 *     be shoved into onboarding (admin personas may legitimately hold ZERO
 *     accounts — moderation-only). While impersonating, the Better Auth session
 *     is still the admin's, so `isAdmin` alone already covers it; the become-user
 *     flags are a belt for the first-render race (see `isImpersonatingSync`).
 *   • Non-'active' recovery state → EXEMPT. Soft-deleted (recoverable/expired)
 *     users are owned by useRecoveryGuard (→ /recover). Without this exemption
 *     the two guards would ping-pong /recover ⇄ /onboarding. deriveAccount…
 *     returns 'active' for undefined, so this never blocks pre-resolve.
 *
 * DUAL-ROLE: the plan gate fires whenever a stylist_account exists AND its plan is
 * unresolved, REGARDLESS of a co-existing client_account. Rationale: the target
 * bypass must close for everyone, and this is NOT a hard lockout of client
 * features — onboarding resolves in ONE tap (choose Free, zero Stripe). Exempting
 * dual-role users instead would reopen the bypass for anyone who also holds a
 * client account. (Documented tradeoff: a client-primary dual-role user with an
 * abandoned stylist plan must complete that one-tap Free selection once.)
 *
 * ROUTE EXCLUSIONS (loop-safety + don't-yank-mid-resolution; both cases):
 *   • ONBOARDING — the role/plan steps live here; redirecting onto it would loop.
 *   • /app/checkout/** — the post-payment RETURN/settling surface
 *     (pages/app/checkout/return). The webhook that flips subscription_status can
 *     lag the redirect back, so the account query may momentarily still read
 *     unresolved here; bouncing a stylist who JUST paid back to onboarding would
 *     be a severe surprise. Prefix mirrors route-access.policy's
 *     ACCOUNT_ROUTE_PREFIXES ('/app/checkout').
 *   • USER_RECOVER — belt-and-suspenders with the recovery-state exemption above
 *     so the restore screen is never contested.
 * We do NOT exclude USER_ACCOUNT_PAY: an already-resolved subscriber managing
 * billing is never gated (they are resolved), and an UNRESOLVED stylist landing
 * there loses no capability by being sent to onboarding (the same embedded
 * PlanCheckoutPanel lives in the onboarding checkout step) — keeping the rule
 * uniform ("anywhere → onboarding") is the least-surprising behavior.
 *
 * TIMING (mirror DashboardPage.useOnboardingGuard): act only after the account
 * query has RESOLVED (!isLoading && !isFetching) AND the Better Auth session has
 * SETTLED (!isSessionPending). !isFetching prevents acting on a STALE snapshot
 * during a post-resolution refetch (post-onboarding we push to /app while
 * account.current is being refetched — the stale "both accounts null" snapshot
 * must NOT bounce the freshly-onboarded user straight back); !isSessionPending
 * prevents acting before role_id hydrates (else a real admin, whose role is
 * still defaulting, could be mis-gated). Flicker-free: while any of these are
 * pending we render normally and never bounce.
 *
 * Inputs arrive as PARAMETERS from AppLayout's single useCurrentUserAccount /
 * useAppRole read — the hook never re-subscribes (no drift from the shell's read).
 * Decision logic is the pure `resolveOnboardingGateDecision` (unit-tested);
 * `replace` (never push) via the runInstant system-redirect seam so the escaped
 * route is dropped from history. A ref latch guards redundant replaces in flight. */
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

  const account = currentUser?.stylist_account ?? null;

  // "Plan resolved" reuses the kernel SSOT USER_POLICY.CAN_USER_HAVE_ACTIVE_ACCOUNT
  // (payment_status === PAID  OR  pricing_plan === FREE && plan_selected_at != null)
  // — the canonical "account is eligible to be active" predicate — PLUS two
  // tolerances so a REDIRECT never yanks a stylist who already engaged a plan:
  //  • subscription_status ∈ {ACTIVE,TRIALING,PAST_DUE,INCOMPLETE} → a REAL engaged
  //    subscription (dunning / mid-payment included); billing surfaces own that
  //    recovery, not onboarding. EXCLUDES INCOMPLETE_EXPIRED / CANCELED / UNPAID —
  //    the backend resets those to FREE + NOT_ACTIVE, so an abandoned 3DS/payment
  //    fail correctly falls through to the gate (a bare != null check let it bypass).
  //  • admin_plan_override === true → an admin CONSCIOUSLY granted the plan
  //    (comped / seeded / migrated); a non-nullable boolean, so test `=== true`.
  // Only an account that is NONE of these — never PAID, never chose Free, never
  // subscribed, not comped — has truly never resolved a plan → gate to onboarding.
  // (Verified against the dev DB: demo/seeded PRO stylists are payment_status=PAID
  // → resolved; the earlier subscription_status-only check wrongly gated them.)
  const planResolved =
    currentUser !== undefined &&
    (USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT({ user: currentUser }) ||
      (account?.subscription_status != null &&
        ENGAGED_SUBSCRIPTION_STATUSES.has(account.subscription_status)) ||
      account?.admin_plan_override === true);

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

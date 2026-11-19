// UI/features/dashboard/DashboardPage.tsx
// Role-aware dashboard — routes to the Stylist or Client variant (an admin is
// redirected to /app/admin by AppLayout's useAdminEntryGuard).
// Stack: TQ v5 + CSS Modules + Phosphor Icons.
//
// DECISION: each role variant is lazy-loaded via next/dynamic with `ssr: false`. The shell ships
// one chunk (skeleton + role resolver); the variant fetches on demand once `role` is known, which
// keeps the dashboard route's initial JS minimal and each role's widgets out of the other role's
// path. `ssr: false` is mandatory: the variants depend on client-only hooks (useAppRole reads a
// client store + native-app context) that crash during static prerender.

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { authClient } from '../../../application/auth/better-auth-client';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppRole } from '../../layouts/useAppRole';
import { useCurrentUser } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { readPrefilledRole } from '../auth/onboarding.helpers';
import { deriveAccountRecoveryState } from '../account/helpers/account-recovery-state.helper';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { RoleSwitcherMolecule } from './components/RoleSwitcher.molecule';
import styles from './DashboardPage.module.css';

/* --- Skeleton loader --- */

function DashboardSkeleton() {
  // Same boxes as the role skeletons that replace it (hero lines, the action
  // or list, a section), so the hand-over between the two moves nothing.
  return (
    <div className={styles.page} aria-busy='true'>
      <div className={styles.skeletonList}>
        <SkeletonAtom variant='text' width='60%' height={32} />
        <SkeletonAtom variant='text' width={160} height={14} />
      </div>
      <SkeletonAtom variant='rect' width='100%' height={52} />
      <div className={styles.skeletonList}>
        <SkeletonAtom variant='text' width='45%' height={24} />
        <SkeletonAtom variant='rect' width='100%' height={96} />
      </div>
    </div>
  );
}

/* --- Lazy variant loaders (ssr:false — variants depend on client-only hooks) --- */

const StylistDashboard = dynamic(
  () =>
    import('./components/StylistDashboard.organism').then(m => ({
      default: m.StylistDashboardOrganism,
    })),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

const ClientDashboard = dynamic(
  () =>
    import('./components/ClientDashboard.organism').then(m => ({
      default: m.ClientDashboardOrganism,
    })),
  { ssr: false, loading: () => <DashboardSkeleton /> }
);

/* --- Main feature component --- */

// DECISION: onboarding guard. A user who completes magic-link auth but never finishes onboarding
// lands here with stylist_account === null AND client_account === null; without the guard the
// dashboard renders the empty client variant (no avatar, no role, no data) and she is stuck, so she
// is sent back to ROUTES_FRONT.ONBOARDING. Admins are exempt (MASTER_ADMIN grants dashboard access
// regardless of account state; moderation-only admins may have neither account). The guard fires
// only after the current-user query resolves (no redirect flash); the dashboard skeleton renders in
// the gap before router replace. The same no-account case is ALSO covered app-wide by
// layouts/guards/useOnboardingPlanGuard (mounted once in AppLayout; same semantics), so this guard
// is a belt on top of it and also drives the local skeleton (`redirectingToOnboarding`); removing
// it is a SEPARATE decision.
function useOnboardingGuard(): boolean {
  const router = useRouter();
  const { role } = useAppRole();
  const { data: currentUser, isLoading, isFetching } = useCurrentUserAccount();
  // DECISION: this guard mixes TWO independent async sources: the account query
  // (useCurrentUserAccount) AND the Better Auth session (the source of role_id, from which
  // useAppRole computes role==='admin'), and must wait for BOTH. If the account query resolves
  // before the session, an admin with both accounts null (a legal state) still has role==='client'
  // (useAppRole defaults before role_id hydrates), so hasNoAccount is falsely true and she is
  // wrongly redirected to onboarding. sessionPending gates the admin exemption until the session
  // arrives.
  const { isPending: sessionPending } = authClient.useSession();

  // H-FUNNEL/AUTH-01: also gate on !isFetching so the guard never acts on STALE
  // "no account" cache during an in-flight refetch. Post-onboarding we push to /app
  // while account.current is being refetched (invalidated, not optimistically seeded);
  // without this gate the stale snapshot (both accounts null) would bounce the
  // freshly-onboarded user straight back to onboarding.
  const hasNoAccount =
    !isLoading &&
    !isFetching &&
    !sessionPending &&
    currentUser !== undefined &&
    currentUser.stylist_account === null &&
    currentUser.client_account === null &&
    role !== 'admin';

  useEffect(() => {
    if (hasNoAccount) {
      // H-FUNNEL: forward a validated ?role hint if it rode in via /app, so the
      // onboarding role step stays pre-selected (role = UX hint only, never authz).
      const prefilledRole = readPrefilledRole(router.query);
      void router.replace(
        prefilledRole
          ? `${ROUTES_FRONT.ONBOARDING}?role=${prefilledRole}`
          : ROUTES_FRONT.ONBOARDING
      );
    }
  }, [hasNoAccount, router]);

  return hasNoAccount;
}

function DashboardPageInner() {
  const tDashboard = useTranslations('dashboard');
  const tButtons = useTranslations('buttons');
  const { role, isRoleResolved, isAdmin, isBecomeUser } = useAppRole();
  const { user, isLoading } = useCurrentUser();
  const {
    data: currentUser,
    isLoading: isAccountLoading,
    isError: isAccountError,
    isFetching: isAccountFetching,
    refetch: refetchAccount,
  } = useCurrentUserAccount();
  const redirectingToOnboarding = useOnboardingGuard();
  // Soft-delete recovery state (DOMAIN_SSOT §13.1), see the gate below.
  const recoveryState = deriveAccountRecoveryState(currentUser);

  if (!isRoleResolved && !isLoading && isAccountError) {
    return (
      <ErrorStateMolecule
        message={tDashboard('loadError')}
        retryLabel={tButtons('retry')}
        onRetry={() => void refetchAccount()}
        isRetrying={isAccountFetching}
      />
    );
  }

  // `!isRoleResolved`: the session may resolve WITHOUT a role (it did not arrive
  // at page start). Such a state used to draw the client dashboard for a stylist
  // too (see the DECISION in layouts/useAppRole.ts); now it waits for the role.
  if (
    isLoading ||
    isAccountLoading ||
    !isRoleResolved ||
    redirectingToOnboarding ||
    (recoveryState !== 'active' && !isAdmin && !isBecomeUser)
  ) {
    return <DashboardSkeleton />;
  }

  const displayName = user?.name?.split(' ')[0] ?? '';

  // An admin never gets a dashboard here: useAdminEntryGuard (AppLayout)
  // replaces /app with /app/admin on every viewport and renders an empty shell
  // meanwhile. This branch only covers the render before that lands; the
  // skeleton keeps the client variant (and its client queries) from mounting.
  if (role === 'admin') {
    return <DashboardSkeleton />;
  }

  // The reading column offers a switch only when both modes are operational.
  // The shared status policy includes EXPIRING; a retained inactive stylist row
  // alone is not evidence of an active stylist mode. Missing-role activation
  // lives in account settings instead.
  const roleZone =
    currentUser?.is_active === true &&
    currentUser.client_account != null &&
    USER_POLICY.utils.IS_USER_HAS_ACTIVE_ACCOUNT({ user: currentUser }) ? (
      <RoleSwitcherMolecule />
    ) : null;

  if (role === 'stylist') {
    return <StylistDashboard displayName={displayName} roleZone={roleZone} />;
  }

  return <ClientDashboard displayName={displayName} roleZone={roleZone} />;
}

/* --- Shell with AppLayout --- */

export function DashboardPageComposition() {
  const t = useTranslations('pages.app');
  return (
    <AppLayoutComposition title={t('dashboardTitle')}>
      <DashboardPageInner />
    </AppLayoutComposition>
  );
}

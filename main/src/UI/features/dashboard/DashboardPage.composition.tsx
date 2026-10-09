// UI/features/dashboard/DashboardPage.tsx
// Role-aware dashboard — routes to the Stylist or Client variant (an admin is
// redirected to /app/admin by AppLayout's useAdminEntryGuard).
// Stack: TQ v5 + CSS Modules + Phosphor Icons.
//
// DECISION (nie usuwaj tego komentarza):
// Each role variant is lazy-loaded via next/dynamic with `ssr: false`. The
// shell only ships one chunk (skeleton + role resolver); the actual variant
// fetches on demand once `role` is known. This keeps initial JS for the
// dashboard route minimal and keeps each role's widgets out of the other
// role's path.
// `ssr: false` is mandatory — the variants depend on client-only hooks
// (useAppRole reads from a client store + native-app context) that crash
// during static prerender.

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { authClient } from '../../../application/auth/better-auth-client';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppRole } from '../../layouts/useAppRole';
import { useCurrentUser } from '../../contexts/AuthContext.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { readPrefilledRole } from '../auth/onboarding.helpers';
import { deriveAccountRecoveryState } from '../account/helpers/account-recovery-state.helper';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { RoleSwitcherMolecule } from './components/RoleSwitcher.molecule';
import { ExpandAccountCardMolecule } from './components/ExpandAccountCard.molecule';
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

// DECISION (nie usuwaj tego komentarza):
// Wave F (F2-F1, F2-F4) — onboarding guard. A user who completes magic-link
// auth but never finishes onboarding lands here with both stylist_account ===
// null AND client_account === null. Without this guard the dashboard renders
// the empty client variant (no avatar, no role, no data) and the user is
// effectively stuck. We force them back to ROUTES_FRONT.ONBOARDING.
//
// Admins are exempt — the MASTER_ADMIN role grants dashboard access regardless
// of account state (admin accounts may be created without stylist/client roles
// for moderation-only personas).
//
// Guard fires only after the current-user query resolves (avoids redirect
// flash while data is still loading). The dashboard skeleton renders during
// the brief gap between query resolve and router replace.
//
// Since the prod incident of 2026-09-02 (client without ClientAccount opened
// /app/client-profile from the drawer → 404 CLIENT_NOT_FOUND error screen) the
// SAME no-account case is ALSO covered app-wide by
// layouts/guards/useOnboardingPlanGuard (mounted once in AppLayout, same
// semantics: settled data, admin/become-user exempt, `?role=` hint forwarded,
// `replace` via runInstant). This dashboard guard is now a belt on top of it
// and additionally drives the local skeleton (`redirectingToOnboarding`).
// Removing it is a SEPARATE decision, not part of that fix.
function useOnboardingGuard(): boolean {
  const router = useRouter();
  const { role } = useAppRole();
  const { data: currentUser, isLoading, isFetching } = useCurrentUserAccount();
  // DECISION (nie usuwaj): ten guard miesza DWA niezależne async źródła —
  // account-query (useCurrentUserAccount) ORAZ Better Auth session (źródło role_id,
  // od którego useAppRole liczy role==='admin'). Musi czekać na OBA. Jeśli
  // account-query rozwiąże się przed sesją, admin z oboma kontami null (legalny stan,
  // patrz blok DECISION wyżej) ma jeszcze role==='client' (useAppRole defaultuje
  // zanim role_id zhydratuje) → fałszywy hasNoAccount → błędny redirect na onboarding.
  // sessionPending bramkuje wyjątek-admina aż sesja dojedzie. S16 fix.
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
  // Soft-delete recovery state (ADRR §13.1) — patrz gate niżej.
  const recoveryState = deriveAccountRecoveryState(currentUser);

  // DECISION (nie usuwaj tego komentarza):
  // Gate the role variant on BOTH async identity sources being resolved — the
  // Better Auth session (`isLoading`, drives `role`) AND the current-user ACCOUNT
  // query (`isAccountLoading`, drives account existence + the onboarding guard).
  // Rendering StylistDashboard/ClientDashboard fires role-scoped protected queries
  // (useDashboardFeed / usePairedList / useFavoriteRecords) that have no `enabled`
  // gate, so they hit the backend the instant a variant mounts. Waiting only on the
  // session left a window — session settled but the account query still in flight —
  // in which the variant rendered and fired those queries before the identity's role
  // was authoritative. On a FRESH account (first login: role_id still null → backend
  // NOT_LOGGED_IN permission) every such query returns 403 UNAUTHORIZED, which the
  // HTTP interceptor surfaces as the spurious "Brak dostępu. Zaloguj się…" toast
  // right before the onboarding guard redirects. This also covers logging in as a
  // DIFFERENT account: a real re-login remounts the tree and starts the account
  // query fresh (`isLoading` true until it first resolves for the new identity), so
  // the role variant again waits for the authoritative role. (An in-place cache
  // invalidation — post-onboarding / role-switch — only flips `isFetching`, not
  // `isLoading`, and is harmless: both accounts stay populated regardless of active
  // role.) Skeleton until both settle → no premature/mismatched role query → no toast.
  //
  // DECISION (nie usuwaj tego komentarza):
  // Ta sama klasa buga dla stanu SOFT-DELETE: recoverable/expired stylistka (is_active=
  // false, role_id nadal STYLIST) po settled-loading wyrenderowalaby StylistDashboard →
  // useDashboardFeed (bez enabled-gate) → 403 USER_DISABLED (DASHBOARD_FEED nie jest na
  // RECOVERABLE_ALLOWLIST) → event-pipeline: falszywy toast + STATE_FULL_RESET + UNCONDITIONAL
  // redirect na /user/login, wygrywajac wyscig z useRecoveryGuard (ktory chce /recover).
  // Skeleton dopoki recoveryState==='active' zatrzymuje wariant (i jego role-scoped query)
  // az recovery-guard dobije nawigacje na /recover. EXEMPT admin/become-user (lustro
  // useRecoveryGuard): admin impersonujacy soft-deleted target NIE jest redirectowany na
  // /recover, wiec gate na recoveryState dalby mu nieskonczony skeleton — przepuszczamy go
  // (zachowanie impersonacji soft-deleted = pre-existing, nie pogarszamy). Admin-ban
  // (deriveAccountRecoveryState → 'active') celowo NIE gate'owany: banned user MA byc
  // ewiktowany przez feed-403 → USER_DISABLED (graceful eviction, nie ma /recover).
  // Ani sesja, ani konto nie odpowiedziały: mówimy to i dajemy ponowienie,
  // zamiast trzymać szkielet bez końca.
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

  // `!isRoleResolved`: sesja mogła się rozstrzygnąć BEZ roli (nie doszła przy
  // starcie strony). Do 2026-10-09 taki stan rysował pulpit klientki także
  // stylistce (DECISION w layouts/useAppRole.ts); teraz czeka na rolę.
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

  // Strefa ról zamyka kolumnę czytania (owner: „poniżej notatek"), na obu
  // wariantach (stylist + client): wariant dostaje ją propem `roleZone`, żeby od
  // 720px stała w drugiej kolumnie, a nie jako pas na całą szerokość pod obiema. Admina pomijamy (osobny return wyżej). Symetrycznie:
  //  • OBA konta (dual-role)  → RoleSwitcher (przełącz aktywny tryb)
  //  • JEDNO konto            → ExpandAccountCard (zaproś do drugiej roli) — to
  //    kanoniczne wejście do ActivateRolePage po wyjęciu aktywacji z drawera
  //  • ZERO kont              → null (onboarding-guard już przekierowuje)
  const hasStylistAccount = currentUser?.stylist_account != null;
  const hasClientAccount = currentUser?.client_account != null;
  let roleZone: ReactNode = null;
  if (hasStylistAccount && hasClientAccount) {
    roleZone = <RoleSwitcherMolecule />;
  } else if (hasStylistAccount) {
    roleZone = (
      <ExpandAccountCardMolecule missingRole={AccountTypeValue.CLIENT} />
    );
  } else if (hasClientAccount) {
    roleZone = (
      <ExpandAccountCardMolecule missingRole={AccountTypeValue.STYLIST} />
    );
  }

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

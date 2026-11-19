import { PendingPaymentNoticeOrganism } from '../features/account/components/PendingPaymentNotice.organism';
import {
  type ReactNode,
  cloneElement,
  isValidElement,
  useCallback,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { resolveRouteAccessCategory } from '../../application/policies/route-access.policy';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { usePublicFeatureFlag } from '../../application/feature-flags/client-feature-flags';
import { OwnPersonAvatarMolecule } from '../shared/profile/OwnPersonAvatar.molecule';
import { NotificationBellOrganism } from '../features/notifications/NotificationBell.organism';
import { BottomTabBarOrganism } from '../components/BottomTabBar/BottomTabBar.organism';
import { AppDrawerOrganism } from '../components/AppDrawer/AppDrawer.organism';
import { useUnreadMessagesCount } from '../features/shared/messaging/hooks/useConversations';
import { useMySalonInvitationsEntry } from '../features/shared/salon-staff/hooks/useMySalonInvitations';
import { toDrawerInvitationsBadge } from '../features/shared/salon-staff/salonInvitationsEntry';
import { AppLayoutErrorBoundaryComposition } from './AppLayoutErrorBoundary.composition';
import {
  useAppBarTitleState,
  AppBarTitleProviderComposition,
} from './useAppBarTitle.composition';
import { AppHeroVisibilityContext } from '../components/AppHero/appHeroVisibility';
import { OverlayContainerContext } from '../primitives/overlayContainer.context';
import { useAppRole, type AppRole } from './useAppRole';
import { useDesktopAccess } from './useDesktopAccess';
import { useCurrentUserAccount } from '../shared/hooks/useCurrentUserAccount';
import { resolveUserDisplayName } from '../shared/format/userDisplayName.formatters';
import { useAuth } from '../contexts/AuthContext.composition';
import {
  buildAccountWebProps,
  buildAccountWebTranslations,
} from './accountWebLayout.props';
import { AnnouncementBannerOrganism } from '../features/announcements/AnnouncementBanner.organism';
import { MaintenanceBannerMolecule } from '../features/maintenance/MaintenanceBanner.molecule';
import { getTabsForRole } from './appTabs.config';
import { useActiveTab } from './useActiveTab';
import { useAppTabs } from './useAppTabs';
import { useScrollCompactHeader } from './useScrollCompactHeader';
import { useKeepFocusedFieldVisible } from '../hooks/useKeepFocusedFieldVisible';
import { useHeroTitleSuppression } from './useHeroTitleSuppression';
import { useCanGoBack, useGoBack } from './useCanGoBack';
import { useDesktopRedirectGuard } from './guards/useDesktopRedirectGuard';
import { useAdminEntryGuard } from './guards/useAdminEntryGuard';
import { useLoggedOutEntryGuard } from './guards/useLoggedOutEntryGuard';
import { useRecoveryGuard } from './guards/useRecoveryGuard';
import { useOnboardingPlanGuard } from './guards/useOnboardingPlanGuard';
import { DefaultSidebarContentOrganism } from './AppLayout.sidebar.organism';
import { AppBarTitleMolecule } from './AppLayout.appBarTitle.molecule';
import { useLandingContext } from '../features/landing/useLandingContext';
import { AccountWebLayoutComposition } from './AccountWebLayout.composition';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';
import styles from './AppLayout.module.css';

/* ─── Types ─── */

export interface AppLayoutProps {
  children: ReactNode;
  /** Static fallback title — overridden by `useAppBarTitle()` from a child. */
  title?: string;
  /** Optional sidebar slot (>=1280px). Defaults to an empty placeholder. */
  sidebar?: ReactNode;
  /** Hide the bottom tab bar — for focused flows (onboarding / role activation)
   *  where global nav would let the user escape mid-flow. */
  hideBottomNav?: boolean;
  /** Fill the available scrollport for flows with their own scrolling stream. */
  contentMode?: 'scroll' | 'fill';
  /** Hide the top-bar back button (router.back) — for linear funnels that own
   *  their own in-page step navigation (onboarding's ActionBar "Wstecz"). Without
   *  this the app-shell back sits next to the step-back as a SECOND, differently
   *  scoped "wstecz" (top = leave the whole funnel, bottom = one step) and lingers
   *  on the terminal success view where it would rewind past a finished flow. With
   *  it hidden the avatar/menu trigger takes the slot instead, so the user still
   *  has an escape (Wyloguj) — never trapped (owner). */
  hideBackButton?: boolean;
  /** Role the drawer should show before the session knows one.
   *  `useAppRole` reads the user's `account_type`, and until onboarding
   *  finishes that stays the schema default CLIENT (the stylist account is
   *  created when she leaves the preferences step). Through stylist
   *  onboarding the drawer therefore showed the client menu and the label
   *  „Klientka", right after she chose „Jestem stylistką". The funnel passes
   *  the role chosen in the form. Without the prop nothing changes: the rest
   *  of the app reads the session.
   *  `null` = no role chosen yet: the drawer does not guess it from the session
   *  and shows only the exit (see the DECISION at getRoleUnresolvedSections). */
  drawerRole?: AppRole | null;
}

/* ─── Component ─── */

export function AppLayoutComposition({
  children,
  title,
  sidebar,
  hideBottomNav,
  contentMode = 'scroll',
  hideBackButton,
  drawerRole,
}: AppLayoutProps) {
  const router = useRouter();
  // `roleUnknown`: the bar and the menu stay neutral (see the DECISION in
  // useAppRole.ts and UNRESOLVED_TABS in appTabs.config.ts).
  const {
    role,
    isRoleUnknown: roleUnknown,
    isLoggedIn,
    isAdmin,
    isBecomeUser,
    isSessionPending,
  } = useAppRole();
  // Unread-message count, shown as a badge on the drawer item „Wiadomości".
  // Polled only while logged in. Shared query key with the inbox and the
  // dashboard, so TanStack Query dedupes it.
  const unreadMessages = useUnreadMessagesCount(isLoggedIn);
  // Aktywna rola sesji („w czym teraz jestem") — rail konta bramkuje się nią,
  // nie posiadaniem konta.
  const { accountType } = useAuth();
  const {
    data: currentUser,
    isLoading: isCurrentUserLoading,
    isFetching: isCurrentUserFetching,
  } = useCurrentUserAccount();
  // Salon team invitations → a drawer item with a badge (both roles). No polling
  // (see the note in useMySalonInvitations). Gate `is_active === true` for the
  // same reason as the bell below: a soft-deleted account does not have this
  // query on the state allowlist, so 403 USER_DISABLED would throw it off the
  // recovery screen. The admin is not an invitation addressee.
  // A failed read is not "no invitations": the item stays without a count, so
  // the screen with the error and a retry stays reachable (see the DECISION in
  // salonInvitationsEntry.ts).
  const { entry: salonInvitationsEntry } = useMySalonInvitationsEntry(
    isLoggedIn && !isAdmin && currentUser?.is_active === true
  );
  const desktopAccess = useDesktopAccess({ isAdmin, isBecomeUser });
  // Landing context (W5) — SSOT for the post-onboarding surface on THIS device:
  // 'admin-frame' (phone frame) | 'lite-dashboard' (desktop account chrome) |
  // 'full-product' (mobile/app). Derived from the SAME desktop-access cascade,
  // so it agrees with `desktopAccess` 1:1 ('redirect' ⟷ 'lite-dashboard').
  const landingContext = useLandingContext();
  const tApp = useTranslations('layout.app');
  const tAccountWeb = useTranslations('layout.accountWeb');

  /* ── AppBar dynamic title (set by child pages via useAppBarTitle) ── */
  const {
    title: dynamicTitle,
    avatar: dynamicAvatar,
    focusedFlow,
    providerValue,
  } = useAppBarTitleState(title, tApp('appTitle'));

  // Static prop (onboarding, role activation) or a screen that entered a
  // focused flow at runtime (`useFocusedFlow`): same consequence for the shell.
  const navHidden = hideBottomNav === true || focusedFlow;

  /* ── Drawer ── */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);

  /* ── AppBar behaviors: compact-on-scroll + AppHero title suppression ── */
  const { headerRef, setScrollEl, scrollEl } = useScrollCompactHeader();
  useKeepFocusedFieldVisible(scrollEl);
  const { heroTitleSuppressed, heroPresent, heroVisibilityValue } =
    useHeroTitleSuppression();

  /* The desktop account layout (>=1280, account routes; gate described at its
   * render branch below) has NO top bar. The page is told so by an empty
   * channel: `useIsUnderAppBar()` is false there and the process header shows
   * the page title itself instead of leaving it to a bar that is not there. */
  const isAccountWebShell =
    desktopAccess !== 'normal' &&
    resolveRouteAccessCategory(router.pathname) === 'account-route' &&
    router.pathname !== ROUTES_FRONT.ONBOARDING;

  /* Page content wrapped in the same context providers + per-route error
   * boundary in EVERY render path (normal shell, lite-dashboard, onboarding) so
   * `useAppBarTitle` / AppHero visibility behave identically and a page crash
   * never escapes the shell. DD3-F13: onReset → resetQueries. */
  const pageContent = (
    <AppHeroVisibilityContext.Provider
      value={isAccountWebShell ? null : heroVisibilityValue}>
      <AppBarTitleProviderComposition value={providerValue}>
        <AppLayoutErrorBoundaryComposition>
          <PendingPaymentNoticeOrganism
            visible={
              role === 'stylist' &&
              !isBecomeUser &&
              !navHidden &&
              currentUser?.is_active === true
            }
          />
          {wrapChildren(children)}
        </AppLayoutErrorBoundaryComposition>
      </AppBarTitleProviderComposition>
    </AppHeroVisibilityContext.Provider>
  );

  /* ── Routing guards (desktop redirect + soft-delete recovery) ──
   * Inputs flow in as params from this single read of role/account — the guards
   * never re-subscribe to useAppRole/useCurrentUserAccount. DECISION comments for
   * the recovery boundary live in useRecoveryGuard.
   *
   * DECISION: /app/** route protection is CLIENT-SIDE with no Next middleware on purpose.
   * These guards are a UX mirror (redirects, not permissions); the backend (auth + RBAC +
   * account-state) is the real boundary. The edge could not read the session anyway: the
   * token lives in localStorage (Capacitor, no cookie). audit:auth-page-guard makes
   * every new /app/** page mount this shell. */
  useDesktopRedirectGuard({ desktopAccess });
  // Admin entry: /app → /app/admin on every viewport (DECISION in the guard);
  // true while replace() is in flight → empty shell below, no flash.
  const isRedirectingAdminEntry = useAdminEntryGuard({
    isAdmin,
    isBecomeUser,
  });
  // No session token on a login-only route → /user/login?from=… before any
  // page (and its authed queries) mounts. Same empty-shell contract.
  const isRedirectingLoggedOut = useLoggedOutEntryGuard({
    isLoggedIn,
    desktopAccess,
  });
  useRecoveryGuard({
    currentUser,
    isLoading: isCurrentUserLoading,
    isFetching: isCurrentUserFetching,
    isAdmin,
    isBecomeUser,
  });
  // App-wide mandatory-plan gate: a stylist with a stylist_account but an
  // UNRESOLVED plan (skipped the plan step) is bounced back to onboarding from
  // ANYWHERE in /app. resolved = active subscription OR chosen-Free OR
  // admin_plan_override (comped). Runs AFTER useRecoveryGuard (soft-delete wins;
  // this guard is recovery-exempt so the two never contest /recover). Inputs from
  // the SAME single account/role read above — never re-subscribes.
  useOnboardingPlanGuard({
    currentUser,
    isLoading: isCurrentUserLoading,
    isFetching: isCurrentUserFetching,
    isSessionPending,
    isAdmin,
    isBecomeUser,
  });

  /* ── Bottom-tab build ── */
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  const tabsConfig = useMemo(
    () => getTabsForRole(roleUnknown ? null : role, exploreEnabled),
    [role, roleUnknown, exploreEnabled]
  );
  const activePath = useActiveTab(tabsConfig, router.pathname);
  const bottomTabs = useAppTabs({
    tabsConfig,
    activePath,
    onDrawerToggle: openDrawer,
    drawerOpen,
  });

  /* ── AppBar back button — hidden on tab roots (DECISION in appTabs.config) ── */
  const canGoBack = useCanGoBack(tabsConfig, router.pathname);
  const goBack = useGoBack(router.pathname);

  const layoutClassName =
    desktopAccess === 'frame'
      ? `${styles.layout} ${styles.layoutFrame}`
      : styles.layout;

  /* Modal overlay container.
   * In frame mode dialogs portal into the phone shell, not into <body>.
   * Otherwise they centered on the whole window (1440) and spilled past the
   * bezel. The callback ref is state, because the context must re-render
   * once the element exists. A plain ref does not render, and the portal
   * would receive null.
   * Reason and scope: see the DECISION in overlayContainer.context.ts. */
  const [appShellElement, setAppShellElement] = useState<HTMLDivElement | null>(
    null
  );
  const overlayContainer = desktopAccess === 'frame' ? appShellElement : null;

  /* ── Entry redirects (admin → /app/admin, logged-out → login) ──
   * While either replace() is in flight, render an empty shell so no page
   * content flashes and no page query fires. */
  if (isRedirectingAdminEntry || isRedirectingLoggedOut) {
    return <div className={styles.layout} aria-hidden='true' />;
  }

  /* ── Desktop AccountWebLayout (account routes >=1280) ──
   * Every desktop context (>=1280 → desktopAccess !== 'normal': admin/dev/
   * become-user 'frame' OR plain-user PREVIEW/PROD 'redirect') renders the
   * account routes as a real web shell (dark nav-rail + centered content),
   * NOT the phone-frame and NOT the old lite-dashboard column. Onboarding is
   * excluded — it stays a full-screen linear funnel (handled below). Product
   * routes are untouched (phone-frame preview / /get-app bounce).
   *
   * DECISION: one desktop account shell for every >=1280 context, replacing both the
   * phone-frame (admin/dev) and the old lite-dashboard (plain user). Gate on
   * desktopAccess !== 'normal' (not landingContext), because 'frame' is >=1280 too.
   * Hydration-safe: desktopAccess starts 'normal', so this branch never runs on SSR or the
   * first client render. */
  if (isAccountWebShell) {
    const accountWebTx = buildAccountWebTranslations(
      tAccountWeb,
      tApp('skipToContent')
    );
    return (
      <AccountWebLayoutComposition
        {...buildAccountWebProps({
          currentUser,
          activeRole: accountType,
          tx: accountWebTx,
        })}>
        {pageContent}
      </AccountWebLayoutComposition>
    );
  }

  /* ── Desktop redirect context (W5), non-account routes ──
   * 'lite-dashboard' == the desktop PREVIEW/PROD plain-user context (mirrors
   * desktopAccess === 'redirect'). Account routes are already handled above by
   * AccountWebLayout, so here only two cases remain:
   *   - onboarding    → account-route BUT a full-screen linear funnel; render
   *     full-screen (no chrome — bottom-nav already suppressed via hideBottomNav).
   *   - product-route → bounce to /get-app (useDesktopRedirectGuard); render an
   *     empty shell while the replace() is in flight. */
  if (landingContext === 'lite-dashboard') {
    if (router.pathname === ROUTES_FRONT.ONBOARDING) {
      // A11y parity (O12): skip-link + <main id='main-content'> like the
      // normal shell; NVT content shell wraps only the routed page content.
      return (
        <div className={styles.layout}>
          <a href='#main-content' className={styles.skipLink}>
            {tApp('skipToContent')}
          </a>
          <main id='main-content' className={styles.onboardingMain}>
            <NavigationContentShellComposition>
              {pageContent}
            </NavigationContentShellComposition>
          </main>
        </div>
      );
    }
    // Product route on desktop — redirect in flight, avoid flashing app UI.
    return <div className={styles.layout} aria-hidden='true' />;
  }

  return (
    <OverlayContainerContext.Provider value={overlayContainer}>
      <div className={layoutClassName} data-desktop-access={desktopAccess}>
        {/* Skip link uses a plain <a> — hash-only navigation is a semantic
         * anchor, not a route change. */}
        <a href='#main-content' className={styles.skipLink}>
          {tApp('skipToContent')}
        </a>

        <div
          className={styles.appShell}
          ref={setAppShellElement}
          data-app-frame={desktopAccess === 'frame' ? 'true' : undefined}>
          {/* Maintenance and announcements sit above the bar. The shell does not
              scroll, so the strips do not pin on their own. */}
          <MaintenanceBannerMolecule />
          <AnnouncementBannerOrganism surface='app' />

          {/* AppBar
           * Layout left→right: back button OR avatar trigger (mutually exclusive
           * — back wins when navigation history is non-empty), then the title.
           * The avatar opens the drawer so users have a constant face/identity
           * anchor visible at the top, not buried in the bottom "more" tab. */}
          <header
            ref={headerRef}
            className={styles.appBar}
            data-hero-title-hidden={heroTitleSuppressed ? '' : undefined}>
            <div className={styles.appBarInner}>
              <div className={styles.appBarSide}>
                {canGoBack && !hideBackButton ? (
                  <button
                    type='button'
                    className={`${styles.backButton} press-feedback`}
                    onClick={goBack}
                    aria-label={tApp('back')}>
                    <CaretLeftIcon size={20} weight='regular' />
                    <span>{tApp('back')}</span>
                  </button>
                ) : currentUser ? (
                  // DECISION: gate on `currentUser` (query-derived, null on the server and
                  // the first render), not `isLoggedIn` (token-derived, differs between SSR
                  // and hydration → hydration mismatch).
                  <button
                    type='button'
                    className={`${styles.avatarTrigger} press-feedback`}
                    onClick={openDrawer}
                    aria-label={tApp('openMenu')}>
                    <OwnPersonAvatarMolecule person={currentUser} size='sm' />
                  </button>
                ) : null}
              </div>
              <AppBarTitleMolecule
                avatar={dynamicAvatar}
                title={dynamicTitle ?? title ?? tApp('appTitle')}
                asHeading={!heroPresent}
              />
              {/* The right side always renders (empty when there is no bell) so the title
                sits at the true centre. The bell is hidden in focused flows
                (hideBottomNav): its deep links would be an escape hatch.
                DECISION: mount the bell only when `is_active === true`. It mounts authed
                queries (dashboard feed, pending-requests poll) that the account-state guard
                refuses for a soft-deleted account, and the resulting USER_DISABLED 403
                resets state and evicts her from /recover before she can restore the account.
                deriveAccountRecoveryState is not usable here: it returns 'active' while
                loading. */}
              <div className={`${styles.appBarSide} ${styles.appBarSideRight}`}>
                {(role === 'stylist' || role === 'client') &&
                  !navHidden &&
                  currentUser?.is_active === true && (
                    <NotificationBellOrganism />
                  )}
              </div>
            </div>
          </header>

          {/* Content
           * Per-route ErrorBoundary: a single render error inside a page must
           * NOT take down the AppBar/BottomTabBar/Drawer — the user needs to
           * remain able to navigate. The top-level boundary in _app.tsx covers
           * shell crashes; this one keeps the chrome interactive. */}
          <main
            ref={setScrollEl}
            id='main-content'
            data-app-content=''
            className={`${styles.content}${navHidden ? ` ${styles.contentNoBottomNav}` : ''}${contentMode === 'fill' ? ` ${styles.contentFill}` : ''}`}>
            <NavigationContentShellComposition>
              {pageContent}
            </NavigationContentShellComposition>
          </main>

          {/* Bottom tabs — hidden in focused flows (onboarding / activation). */}
          {!navHidden && (
            <BottomTabBarOrganism
              tabs={bottomTabs}
              className={styles.bottomBar}
            />
          )}

          {/* Navigation drawer (side panel, possessive labels, scroll-locked) */}
          <AppDrawerOrganism
            isOpen={drawerOpen}
            onClose={closeDrawer}
            role={drawerRole ?? role}
            roleUnresolved={drawerRole === null || roleUnknown}
            isLoggedIn={isLoggedIn}
            unreadMessages={unreadMessages}
            salonInvitations={toDrawerInvitationsBadge(salonInvitationsEntry)}
            userName={resolveUserDisplayName(currentUser)}
          />
        </div>

        {/* Desktop sidebar slot (>=1280px, frame mode only).
         * If no `sidebar` prop is provided we render a default panel
         * describing the desktop preview — better than an empty white
         * box that reads as a broken layout (AppLayout.sidebar.organism.tsx). */}
        {desktopAccess === 'frame' && (
          <aside
            className={styles.sidebar}
            aria-label={tApp('sidebarToolsAriaLabel')}>
            {sidebar ?? <DefaultSidebarContentOrganism />}
          </aside>
        )}
      </div>
    </OverlayContainerContext.Provider>
  );
}

/**
 * Forward `key` re-mount semantics for view transitions: when the page changes
 * we want React to throw away the old subtree so the snapshot diff captures a
 * full DOM swap. Cloning with `key=router.pathname` is the cheapest way to
 * achieve that without forcing every page to opt in.
 *
 * If `children` is not a single element (rare), we render it as-is.
 */
function wrapChildren(children: ReactNode): ReactNode {
  // Next.js owns the page key; cloning keeps the element's existing identity.
  return isValidElement(children) ? cloneElement(children) : children;
}

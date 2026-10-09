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
import { AvatarAtom } from '../components/Avatar/Avatar.atom';
import { NotificationBellOrganism } from '../features/notifications/NotificationBell.organism';
import { BottomTabBarOrganism } from '../components/BottomTabBar/BottomTabBar.organism';
import { AppDrawerOrganism } from '../components/AppDrawer/AppDrawer.organism';
import { useUnreadMessagesCount } from '../features/messaging/hooks/useConversations';
import { useMySalonInvitationsEntry } from '../features/shared/salon-staff/hooks/useMySalonInvitations';
import { toDrawerInvitationsBadge } from '../features/shared/salon-staff/salonInvitationsEntry';
import { ErrorBoundaryComposition } from '../components/ErrorBoundary.composition';
import { useQueryClient } from '@tanstack/react-query';
import {
  useAppBarTitleState,
  AppBarTitleProviderComposition,
} from './useAppBarTitle.composition';
import { AppHeroVisibilityContext } from '../components/AppHero/appHeroVisibility';
import { OverlayContainerContext } from '../primitives/overlayContainer.context';
import { useViewTransitionRouter } from './useViewTransitionRouter';
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
import { TrialCountdownBannerMolecule } from '../components/TrialCountdownBanner/TrialCountdownBanner.molecule';
import { resolveTrialBannerEndsAt } from '../components/TrialCountdownBanner/trialCountdown.logic';
import { getTabsForRole } from './appTabs.config';
import { useActiveTab } from './useActiveTab';
import { useAppTabs } from './useAppTabs';
import { useScrollCompactHeader } from './useScrollCompactHeader';
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
   *  has an escape (Wyloguj) — never trapped (owner 2026-07-12). */
  hideBackButton?: boolean;
  /** Rola, którą ma pokazać szuflada, gdy sesja jeszcze jej nie zna (S123).
   *  `useAppRole` czyta `account_type` użytkownika, a ten do końca onboardingu
   *  stoi na domyślnym CLIENT (schema default; konto stylistki powstaje dopiero
   *  przy wyjściu z kroku PREFERENCJE). Przez cały onboarding stylistki szuflada
   *  pokazywała więc menu KLIENTKI razem z etykietą „Klientka", zaraz po tym,
   *  jak użytkowniczka wybrała „Jestem stylistką". Lejek podaje tu rolę wybraną
   *  w formularzu; bez propa nic się nie zmienia (reszta aplikacji czyta sesję).
   *  `null` = rola jeszcze niewybrana: szuflada nie zgaduje jej z sesji, tylko
   *  pokazuje samo wyjście (DECISION przy getRoleUnresolvedSections). */
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
  const navigate = useViewTransitionRouter();
  const queryClient = useQueryClient();
  // `roleUnknown`: belka i menu w stanie neutralnym (DECISION w useAppRole.ts
  // i przy UNRESOLVED_TABS).
  const {
    role,
    isRoleUnknown: roleUnknown,
    isLoggedIn,
    isAdmin,
    isBecomeUser,
    isSessionPending,
  } = useAppRole();
  // Globalny licznik nieprzeczytanych → badge w drawerze („Wiadomości"). Poll
  // tylko dla zalogowanych; współdzielony klucz z inboxem/dashboardem (TQ dedup).
  const unreadMessages = useUnreadMessagesCount(isLoggedIn);
  // Aktywna rola sesji („w czym teraz jestem") — rail konta bramkuje się nią,
  // nie posiadaniem konta.
  const { accountType } = useAuth();
  const {
    data: currentUser,
    isLoading: isCurrentUserLoading,
    isFetching: isCurrentUserFetching,
  } = useCurrentUserAccount();
  // Zaproszenia do zespołu salonu → pozycja z badge'em w drawerze (obie role).
  // Bez pollingu (DECISION w useMySalonInvitations). Gate `is_active === true`
  // z tego samego powodu co dzwoneczek niżej: konto soft-deleted nie ma tej
  // kwerendy na allowliście stanu → 403 USER_DISABLED wyrzucałby je z ekranu
  // odzyskiwania. Admin nie jest adresatem zaproszeń.
  // Nieudany odczyt ≠ „brak zaproszeń”: pozycja zostaje bez licznika, żeby
  // ekran z błędem i ponowieniem był osiągalny (DECISION w salonInvitationsEntry).
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
  const tErrors = useTranslations('errors');
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
  const { headerRef, setScrollEl } = useScrollCompactHeader();
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
        <ErrorBoundaryComposition
          fallbackTitle={tErrors('unexpectedError')}
          fallbackAction={tErrors('tryAgain')}
          onReset={() => {
            void queryClient.resetQueries();
          }}>
          {wrapChildren(children)}
        </ErrorBoundaryComposition>
      </AppBarTitleProviderComposition>
    </AppHeroVisibilityContext.Provider>
  );

  /* ── Routing guards (desktop redirect + soft-delete recovery) ──
   * Inputs flow in as params from this single read of role/account — the guards
   * never re-subscribe to useAppRole/useCurrentUserAccount. DECISION comments for
   * the recovery boundary live in useRecoveryGuard.
   *
   * DECISION (nie usuwaj tego komentarza):
   * Ochrona tras /app/** jest CLIENT-SIDE i celowo bez Next.js middleware.
   * AppLayout jest jedynym shell-guardem widoku użytkownika (desktop-redirect +
   * recovery + role). To NIE jest granica bezpieczeństwa — backend (/api/v1/**:
   * auth + RBAC + account-state) jest prawdziwą granicą; te guardy to UX-lustro
   * (redirect, nie permission), by user nie błądził po appce w stanie
   * soft-delete/desktop. Brak middleware = świadomy wybór: cała powierzchnia
   * /app jest statyczna/ISR (SSG) + Capacitor WebView, gdzie token żyje w
   * localStorage (nie cookie), więc edge-middleware i tak nie miałoby dostępu do
   * sesji. Strażnik tests/audit/auth-page-guard.sh pilnuje, by każda nowa strona
   * /app/** dociągała ten shell. */
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

  /* ── Kontener nakładek modalnych ──
   * W trybie ramki dialogi portalują się DO SKORUPY TELEFONU, nie do <body>:
   * inaczej centrowały się na całym oknie (1440) i wychodziły poza obudowę.
   * Callback-ref przez stan, bo kontekst musi się przerenderować, gdy element
   * wreszcie istnieje — zwykły ref nie odpala renderu i portal dostałby null.
   * Uzasadnienie i zakres: DECISION w overlayContainer.context.ts. */
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
   * DECISION (nie usuwaj tego komentarza):
   * Ujednolica desktop konta między kontekstami: dawniej admin/dev widzieli
   * treść konta w phone-frame, a plain-user w osobnym lite-dashboard chrome — dwa różne (oba
   * mobilne) chrome. AccountWebLayout zastępuje OBA dla account-routes. Gate na
   * desktopAccess !== 'normal' (nie na landingContext), bo 'frame' też jest
   * >=1280. Hydration-safe: desktopAccess startuje 'normal' (viewportWidth=0) →
   * ta gałąź nie odpala na SSR / pierwszym CSR, swap po zmierzeniu viewportu. */
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
          {/* Maintenance banner — highest-priority strip, above announcements, sticky */}
          <MaintenanceBannerMolecule />

          {/* Announcement banner — above AppBar, sticky */}
          <AnnouncementBannerOrganism />

          {/* Trial countdown banner — stylist-only, shown ≤7 days before trial ends.
           * Placed above AppBar so it is always visible regardless of scroll position.
           * Per-session dismissable (sessionStorage) — resurfaces on next login/tab
           * to maintain loss-aversion urgency throughout the trial window. */}
          {role === 'stylist' && (
            <TrialCountdownBannerMolecule
              // Only a trial that is still running AND will convert (DECISION
              // in trialCountdown.logic): trial_ends_at is never cleared.
              trialEndsAt={resolveTrialBannerEndsAt(
                currentUser?.stylist_account
              )}
              onClick={() => navigate(ROUTES_FRONT.USER_ACCOUNT_PAY)}
            />
          )}

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
                    className={`${styles.backButton} haptic-press`}
                    onClick={goBack}
                    aria-label={tApp('back')}>
                    <CaretLeftIcon size={20} weight='regular' />
                    <span>{tApp('back')}</span>
                  </button>
                ) : currentUser ? (
                  // DECISION (nie usuwaj tego komentarza):
                  // Gate on `currentUser` (TQ-derived, server-stable null on first
                  // render) instead of `isLoggedIn` (token-derived, differs between
                  // SSR and hydration → React hydration mismatch error). The trigger
                  // appears once the session query resolves, which is the same time
                  // the rest of the layout reads user data.
                  <button
                    type='button'
                    className={`${styles.avatarTrigger} haptic-press`}
                    onClick={openDrawer}
                    aria-label={tApp('openMenu')}>
                    <AvatarAtom
                      src={currentUser.stylist_account?.avatar_url ?? undefined}
                      // User.name domyślnie '' (klasa S67a) — helper pomija puste.
                      name={resolveUserDisplayName(currentUser) ?? 'U'}
                      size='sm'
                    />
                  </button>
                ) : null}
              </div>
              <AppBarTitleMolecule
                avatar={dynamicAvatar}
                title={dynamicTitle ?? title ?? tApp('appTitle')}
                asHeading={!heroPresent}
              />
              {/* Prawy bok — zawsze renderowany (pusty u klientki) dla balansu z
                lewym bokiem, żeby tytuł był na prawdziwym środku. Dzwoneczek v1
                tylko stylistka; ukryty w focused-flow (hideBottomNav), bo jego
                deep-linki byłyby furtką ucieczki z zamkniętego flow.
                DECISION (nie usuwaj tego komentarza):
                Gate `is_active === true` — dzwoneczek montuje dwa AUTHED query
                (useDashboardFeed + usePendingRequests poll 60s). Konto soft-
                deleted (RECOVERABLE/EXPIRED) ląduje przez recovery-guard na
                /recover WEWNĄTRZ tego shellu; account-state-guard (§13.1) nie ma
                DASHBOARD_FEED/PAIRING na allowlistach nieaktywnego stanu → 403
                USER_DISABLED → event pipeline: fałszywy toast „Użytkownik został
                wyłączony" (recoverable ≠ banned) + STATE_FULL_RESET (czyści cache
                currentUser) + UNCONDITIONAL redirect na /user/login = eviction z
                ekranu recovery ZANIM user kliknie „Przywróć konto". Gate na
                `is_active === true` (nie deriveAccountRecoveryState==='active',
                które dla undefined/loading zwraca 'active' → race: query poleci
                przed rozwiązaniem stanu) montuje dzwoneczek DOPIERO gdy stan
                pozytywnie aktywny → recoverable NIGDY go nie montuje, zero 403.
                Graceful-eviction banned-usera na /app/* NIE łamana — page-queries
                tras produktu dalej triggerują pipeline USER_DISABLED. */}
              <div className={`${styles.appBarSide} ${styles.appBarSideRight}`}>
                {role === 'stylist' &&
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
         * box that reads as a broken layout (see DECISION below). */}
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

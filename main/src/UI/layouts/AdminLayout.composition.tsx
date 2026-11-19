import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppLinkAtom as Link } from '../components/AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { CaretLeftIcon, ListIcon, XIcon } from '@phosphor-icons/react';
import type { IconWeight } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext.composition';
import { AppHeroVisibilityContext } from '../components/AppHero/appHeroVisibility';
import { BottomTabBarOrganism } from '../components/BottomTabBar/BottomTabBar.organism';
import { BrandLockupMolecule } from '../components/BrandLockup/BrandLockup.molecule';
import { ErrorBoundaryComposition } from '../components/ErrorBoundary.composition';
import { useErrorBoundaryCopy } from '../components/useErrorBoundaryCopy';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';
import { runInstant } from '../../application/routing/navigation.possibilities.api';
import { useViewTransitionRouter } from './useViewTransitionRouter';
import { useAppRole } from './useAppRole';
import { useHeroTitleSuppression } from './useHeroTitleSuppression';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useAdminAttentionCounts } from '../features/admin/hooks/useAdminAttentionCounts';
import {
  isAdminPathActive,
  resolveNavAttention,
} from '../features/admin/navigation/adminNav.model';
import { ADMIN_BOTTOM_TABS } from './AdminLayout.sidebar.config';
import { AdminSidebarNavOrganism } from './AdminLayout.sidebarNav.organism';
import {
  ROUTES_FRONT,
  ROUTES_FRONT_APP,
} from '@kernel/domain/routing/routing.config';
import styles from './AdminLayout.module.css';

/* ─── Types ─── */

export interface AdminLayoutProps {
  children: ReactNode;
  title?: string;
}

/* ─── Component ─── */

export function AdminLayoutComposition({ children, title }: AdminLayoutProps) {
  const router = useRouter();
  const navigate = useViewTransitionRouter();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const t = useTranslations('layout.admin');
  const tAttention = useTranslations('admin.attention');
  const errorCopy = useErrorBoundaryCopy();
  const tApp = useTranslations('layout.app');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The page header band reports itself like the app's AppHero: while it is
  // on screen the bar does not repeat the title (AdminPageLayout).
  const { heroTitleSuppressed, heroVisibilityValue } =
    useHeroTitleSuppression();
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileScrimRef = useRef<HTMLDivElement>(null);

  // A left swipe closes the mobile menu (the shared gesture, see the DECISION in
  // UI/hooks/useSwipeDismiss.ts). The panel mounts only while open, so closing
  // waits for the slide-out to end, otherwise unmounting would cut the motion.
  // Mobile menu is a modal panel: focus moves in, Tab stays inside, Escape
  // closes, and the page under the scrim goes inert. Without that, Tab walked
  // the page under the scrim and the drawer was reachable only with Shift+Tab.
  useFocusTrap(mobileNavRef, {
    active: sidebarOpen,
    onEscape: () => setSidebarOpen(false),
    initialFocus: 'first',
    // Not portaled: inert everything OUTSIDE the panel's ancestry, so the
    // scrim (its parent) stays clickable to close.
    inert: true,
  });
  useSwipeDismiss({
    targetRef: mobileNavRef,
    backdropRef: mobileScrimRef,
    direction: 'left',
    onDismiss: () => window.setTimeout(() => setSidebarOpen(false), 280),
    enabled: sidebarOpen,
  });

  // DECISION: admin is a separate shell outside AppLayout, so it must set `document.title`
  // itself; otherwise Next's route announcer reads the raw path („/app/admin/users”) to screen
  // readers and tabs/history stay blank. Same format as AppLayout: „|” separator (no dash or
  // middle dot), brand from layout.app.appTitle.
  const brandName = tApp('appTitle');
  const resolvedDocTitle = title ?? t('defaultTitle');
  useEffect(() => {
    document.title =
      resolvedDocTitle && resolvedDocTitle !== brandName
        ? `${resolvedDocTitle} | ${brandName}`
        : brandName;
  }, [resolvedDocTitle, brandName]);

  // DECISION: a client-side admin gate on top of the hard backend boundary (API 403): a
  // confirmed non-admin goes to /app instead of an empty heavy shell. No Next middleware on
  // purpose: the session token lives in localStorage (Capacitor, no cookie), so the edge could
  // not read the role. audit:auth-page-guard requires this shell on /app/admin/**.
  const { isLoggedIn, isAdmin, isSessionPending } = useAppRole();
  useEffect(() => {
    // DECISION: wait for the session to resolve before redirecting. While it loads,
    // `isLoggedIn` (token present) is already true and `isAdmin` still false, so a real admin
    // would be bounced on every deep link or refresh. Redirect only a CONFIRMED non-admin.
    if (isLoggedIn && !isAdmin && !isSessionPending) {
      void runInstant(
        'admin-layout-guard',
        () => router.replace(ROUTES_FRONT_APP.APP),
        ROUTES_FRONT_APP.APP
      );
    }
  }, [isLoggedIn, isAdmin, isSessionPending, router]);

  // Liczniki "czeka na Ciebie" pod badge przy pozycjach menu. Co każdy liczy
  // i dokąd prowadzi: features/admin/admin-attention.config.ts. Gate na
  // potwierdzoną rolę — okno hydratacji sesji nie strzela 403.
  const { counts: attentionCounts } = useAdminAttentionCounts(
    isLoggedIn && isAdmin
  );

  const sidebarContent = (
    <>
      <div className={styles.sidebarHeader}>
        {/* Lockup: signet plus Nailfolio, the same SSOT as the navbar. */}
        <Link href={ROUTES_FRONT_APP.ADMIN} className={styles.sidebarBrand}>
          <BrandLockupMolecule markClassName={styles.brandMark} />
        </Link>
        <Link href={ROUTES_FRONT.HOME} className={styles.backButton}>
          <CaretLeftIcon size={18} weight='regular' />
          <span>{t('backToSite')}</span>
        </Link>
      </div>
      <AdminSidebarNavOrganism
        counts={attentionCounts}
        onNavigate={() => setSidebarOpen(false)}
        onLogout={logout}
      />
    </>
  );

  /* ─── Bottom nav tabs (mobile — 5 most critical) ─── */
  const bottomTabs = ADMIN_BOTTOM_TABS.map(tab => {
    const active = isAdminPathActive(
      router.pathname,
      tab.path,
      ROUTES_FRONT_APP.ADMIN
    );
    const weight: IconWeight = active ? 'fill' : 'regular';
    const attention = resolveNavAttention(tab, attentionCounts, tAttention);
    const IconComp = tab.icon;
    return {
      label: t(tab.labelKey),
      icon: <IconComp size={22} weight={weight} />,
      active,
      // Hook channel (NIE raw push): AC "Bottom tab: exit na tap" obejmuje
      // też tabbar admina — raw push = best-effort grade, exit ucięty na
      // prefetched trasach (NVT adversarial L3-M3).
      onClick: () => navigate(attention.href),
      ...(attention.count > 0 && attention.description !== null
        ? {
            badgeCount: attention.count,
            badgeAriaLabel: attention.description,
          }
        : {}),
    };
  });

  return (
    <>
      {/* Skip link — WCAG */}
      <a href='#main-content' className={styles.skipLink}>
        {t('skipToContent')}
      </a>

      <div className={styles.layout}>
        {/* Desktop sidebar — sticky, visible >=1024px */}
        <aside className={styles.sidebar}>{sidebarContent}</aside>

        {/* Mobile sidebar overlay — visible <1024px when open */}
        {sidebarOpen && (
          <div
            ref={mobileScrimRef}
            className={styles.sidebarOverlay}
            // DECISION: only a click on the scrim itself closes. Stopping click and keydown
            // propagation on the panel instead also swallowed Escape and Tab before
            // useFocusTrap's document listener saw them.
            onClick={e => {
              if (e.target === e.currentTarget) {
                setSidebarOpen(false);
              }
            }}
            role='presentation'>
            {/* aria-modal-focus-trap-allow: side panel with swipe-to-close and
                its own tappable scrim, same shape as AppDrawer; trapped by
                useFocusTrap above (inert background, Escape, Tab cycle). */}
            <aside
              ref={mobileNavRef}
              className={styles.sidebarMobile}
              role='dialog'
              aria-modal='true'
              aria-label={t('sidebarMobileAriaLabel')}>
              <div className={styles.sidebarMobileClose}>
                <button
                  type='button'
                  className={styles.closeButton}
                  onClick={() => setSidebarOpen(false)}
                  aria-label={t('closeMenu')}>
                  <XIcon size={20} />
                </button>
              </div>
              {sidebarContent}
            </aside>
          </div>
        )}

        {/* Main area: top bar + content */}
        <div className={styles.main}>
          {/* Top bar — mobile only (hamburger + page title) */}
          <header
            className={styles.topBar}
            data-hero-title-hidden={heroTitleSuppressed ? '' : undefined}>
            <div className={styles.topBarInner}>
              <button
                type='button'
                className={styles.hamburgerButton}
                onClick={() => setSidebarOpen(true)}
                aria-label={t('openMenu')}
                aria-expanded={sidebarOpen}>
                <ListIcon size={22} />
              </button>
              <span className={styles.topBarTitle}>
                {title ?? t('defaultTitle')}
              </span>
            </div>
          </header>

          {/* Page content
           * Per-route ErrorBoundary keeps the admin sidebar/top-bar/bottom-nav
           * alive when a single admin view throws on render. */}
          <main
            id='main-content'
            className={styles.content}
            data-app-content=''>
            <NavigationContentShellComposition>
              {/* DD3-F13: onReset → resetQueries so "Try again" forces fresh fetch */}
              <ErrorBoundaryComposition
                fallbackTitle={errorCopy.title}
                fallbackAction={errorCopy.action}
                onReset={() => {
                  void queryClient.resetQueries();
                }}>
                <AppHeroVisibilityContext.Provider value={heroVisibilityValue}>
                  {children}
                </AppHeroVisibilityContext.Provider>
              </ErrorBoundaryComposition>
            </NavigationContentShellComposition>
          </main>
        </div>
      </div>

      {/* Bottom tab nav — mobile only (<1024px), rendered outside layout flex */}
      <BottomTabBarOrganism tabs={bottomTabs} className={styles.bottomNav} />
    </>
  );
}

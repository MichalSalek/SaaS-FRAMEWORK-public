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
  const tErrors = useTranslations('errors');
  const tApp = useTranslations('layout.app');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // The page header band reports itself like the app's AppHero: while it is
  // on screen the bar does not repeat the title (AdminPageLayout).
  const { heroTitleSuppressed, heroVisibilityValue } =
    useHeroTitleSuppression();
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileScrimRef = useRef<HTMLDivElement>(null);

  // Swipe w lewo zamyka mobilne menu (wspólny gest, DECISION w
  // UI/hooks/useSwipeDismiss.ts). Panel montuje się tylko otwarty, więc
  // zamknięcie czeka na koniec wysuwu, inaczej odmontowanie ucięłoby ruch.
  // Mobile menu is a modal panel: focus moves in, Tab stays inside, Escape
  // closes, the page under the scrim goes inert (S122 review: Tab walked the
  // page under the scrim and the drawer was reachable only with Shift+Tab).
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

  // DECISION (nie usuwaj tego komentarza):
  // Admin to OSOBNY shell (poza AppLayout) i NIE ustawiał `document.title`.
  // Bez tego Next.js (pages-router) route-announcer `#__next-route-announcer__`
  // przy nawigacji client-side między stronami /app/admin/** fałbekował na
  // SUROWĄ ścieżkę „/app/admin/users" (leak dla czytnika ekranu), a taby i
  // historia przeglądarki zostawały puste. Mirrorujemy zresolvowany tytuł
  // (prop `title` → t('defaultTitle')) do document.title — reużywa istniejących
  // stringów i18n, zero nowych kluczy. Ten sam wzorzec + format co AppLayout
  // (useAppBarTitle S60a): separator „|" (nie myślnik ani kropka środkowa — floor §7), brand z
  // layout.app.appTitle. Announcer to rodzeństwo w drzewie Next → czyta
  // document.title PO tym efekcie.
  const brandName = tApp('appTitle');
  const resolvedDocTitle = title ?? t('defaultTitle');
  useEffect(() => {
    document.title =
      resolvedDocTitle && resolvedDocTitle !== brandName
        ? `${resolvedDocTitle} | ${brandName}`
        : brandName;
  }, [resolvedDocTitle, brandName]);

  // DECISION (nie usuwaj tego komentarza):
  // Defense-in-depth — API zwraca 403 dla non-admin, ale admin UI shell jest
  // ciężki (sidebar + bottom-nav + ikony) i pokazywanie pustej zawartości za
  // forbidden API call to słabe UX. Redirect zalogowanego nie-admina do /app.
  // Niezalogowanym pozwalamy załadować shell — useSession może hydratować
  // asynchronicznie; auth-flow przejmuje redirect (login gate w AppContext).
  // Brak Next.js middleware z premedytacją — ten admin-gate jest client-side
  // (warstwa nad twardą granicą backendu: API 403 dla non-admina). Token sesji
  // żyje w localStorage (Capacitor WebView, nie cookie) → edge-middleware i tak
  // nie odczytałoby roli. Audit tests/audit/auth-page-guard.sh egzekwuje obecność
  // tego shella na każdej stronie /app/admin/**.
  const { isLoggedIn, isAdmin, isSessionPending } = useAppRole();
  useEffect(() => {
    // DECISION (nie usuwaj tego komentarza):
    // Czekaj aż sesja Better Auth się rozwiąże, zanim odeślesz. W oknie ładowania
    // `isLoggedIn` (token w localStorage) jest już true, a `isAdmin` (session.role_id)
    // jeszcze false → realny admin byłby przekierowany na /app przy KAŻDYM deep-linku
    // / refreshu trasy admina (F19). Redirect tylko POTWIERDZONEGO nie-admina.
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
        {/* Lockup sygnet + Nailfolio — ten sam SSOT co navbar (S88). */}
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
            // DECISION (nie usuwaj tego komentarza): only a click on the scrim
            // itself closes. The panel used to stop click AND keydown
            // propagation instead, and the keydown stop also swallowed Escape
            // and Tab before useFocusTrap's document listener saw them.
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
          <main id='main-content' className={styles.content}>
            <NavigationContentShellComposition>
              {/* DD3-F13: onReset → resetQueries so "Try again" forces fresh fetch */}
              <ErrorBoundaryComposition
                fallbackTitle={tErrors('unexpectedError')}
                fallbackAction={tErrors('tryAgain')}
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

import { usePublicHeaderHeight } from '../shared/hooks/usePublicHeaderHeight';
import { type ReactNode, useEffect, useRef } from 'react';
import { AppLinkAtom as Link } from '../components/AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { GlobeSimpleIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  I18N_CONFIG,
  LOCALE_SHORT_LABELS,
  getNextLocale,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import {
  AppBarOrganism,
  type AppBarLink,
} from '../components/AppBar/AppBar.organism';
import {
  HeaderUserMenuOrganism,
  MobileAccountAvatarOrganism,
} from '../components/HeaderUserMenu/HeaderUserMenu.organism';
import { LinkButtonAtom } from '../components/Button/LinkButton.atom';
import { BrandLockupMolecule } from '../components/BrandLockup/BrandLockup.molecule';
import { useHasLiveAccountSession } from '../contexts/AuthContext.composition';
import { useHydrated } from '../hooks/useHydrated';
import { useAppEntryMode } from '../shared/hooks/useAppEntryMode';
import { SupportFloatingButtonOrganism } from '../components/SupportFloatingButton/SupportFloatingButton.organism';
import { useScrollIntent } from '../hooks/useScrollIntent';
import { useScrollDepth } from '../hooks/useScrollDepth';
import { useInternalLinkTracking } from '../hooks/useInternalLinkTracking';
import { PublicFooterOrganism } from './PublicFooter.organism';
import { AnnouncementBannerOrganism } from '../features/announcements/AnnouncementBanner.organism';
import { MaintenanceBannerMolecule } from '../features/maintenance/MaintenanceBanner.molecule';
import { ErrorBoundaryComposition } from '../components/ErrorBoundary.composition';
import { useErrorBoundaryCopy } from '../components/useErrorBoundaryCopy';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';
import { runNavigationIntent } from '../../application/routing/navigation.possibilities.api';
import { AppReturnBarMolecule } from './PublicLayout.returnBar.molecule';
import styles from './PublicLayout.module.css';

/* ─── Types ─── */

export interface PublicLayoutProps {
  children: ReactNode;
  localePaths?: Partial<Record<LocaleType, string>>;
}

/* ─── LanguageSwitcher (PL / EN / DE cycle) ─── */

interface LanguageSwitcherProps {
  current: LocaleType;
  onCycle: () => void;
}

function LanguageSwitcher({ current, onCycle }: LanguageSwitcherProps) {
  // The name was an English literal on every locale, so a Polish or German
  // screen reader announced "Switch language" in the middle of a Polish page.
  const t = useTranslations('layout.public');
  return (
    <button
      type='button'
      className={styles.langSwitcher}
      onClick={onCycle}
      aria-label={t('switchLanguageAriaLabel', {
        current: LOCALE_SHORT_LABELS[current],
      })}>
      <GlobeSimpleIcon size={16} className={styles.langIcon} />
      <span>{LOCALE_SHORT_LABELS[current]}</span>
    </button>
  );
}

/* ─── MobilePanelCta: drawer action (owner). Logged in -> „Idź do panelu" (/app), logged out ->
 *     „Zaloguj się". Replaces the account avatar dropdown in the mobile hamburger overlay (less
 *     nesting). ─── */
function MobilePanelCta() {
  const t = useTranslations('layout.public');
  const hasLiveSession = useHasLiveAccountSession();
  const mounted = useHydrated();
  // DECISION: mounted gate as in HeaderUserMenu. The session is unknown on the
  // server, so SSR and the first render show the login CTA and the swap waits
  // for hydration (no mismatch). Gated on a LIVE session, not the bare token: an
  // expired token must show „Zaloguj się”, not a panel link bouncing to login.
  const loggedIn = mounted && hasLiveSession;
  return (
    <LinkButtonAtom
      href={loggedIn ? ROUTES_FRONT.APP : ROUTES_FRONT.USER_LOG}
      variant='primary'
      size='sm'>
      {loggedIn ? t('goToPanel') : t('loginButton')}
    </LinkButtonAtom>
  );
}

/* ─── Public nav config (built inside component — requires t) ─── */

/* ─── PublicLayout ─── */

/**
 * Public-facing layout (homepage, landing pages, legal, blog, etc.).
 *
 * Architecture:
 * - Header: AppBar with logo, public nav, LanguageSwitcher, login CTA
 *   • Wrapped in a sticky `headerRef` div that toggles `data-compact` when
 *     scrollY > 50 (rAF-throttled scroll listener).
 * - Main: full-width content area, pages own their padding/max-width.
 * - Footer: PublicFooter (5 sections — links/newsletter/trust/social/©).
 * - Scroll-reveal: IntersectionObserver watches `[data-scroll-reveal]` and
 *   adds `data-revealed` on entry. Pages opt-in by adding the attribute.
 *
 * IMPORTANT: Bottom CTA bar is NOT part of this layout. Pages render their
 * own `<StickyCtaBar>` per-page (see MIG-B1 architectural decisions).
 */
export function PublicLayoutComposition({
  children,
  localePaths,
}: PublicLayoutProps) {
  const router = useRouter();
  const t = useTranslations('layout.public');
  const tNav = useTranslations('nav');
  const errorCopy = useErrorBoundaryCopy();

  // Reading depth of public pages. Wired into the layout, not each composition: the static
  // pages share this layout, and per-page wiring would drift on the first new page.
  useScrollDepth();
  // Edges of the transition graph: exactly what someone clicked to go further.
  useInternalLinkTracking();

  /* ─── Public nav links (built here so labels are translated) ───
     In 'get-app' mode HeaderUserMenu renders a "Otwórz na telefonie" CTA button,
     so the identically-labelled getApp nav link is dropped to avoid two
     adjacent duplicates. */
  const appEntryMode = useAppEntryMode();
  const PUBLIC_NAV_LINKS: AppBarLink[] = [
    {
      label: tNav('forStylists'),
      href: ROUTES_FRONT.FOR_STYLISTS,
      hint: tNav('hints.forStylists'),
    },
    {
      label: tNav('forClients'),
      href: ROUTES_FRONT.FOR_CLIENTS,
      hint: tNav('hints.forClients'),
    },
    {
      label: tNav('forStudios'),
      href: ROUTES_FRONT.FOR_STUDIOS,
      hint: tNav('hints.forStudios'),
    },
    {
      label: tNav('pricing'),
      href: ROUTES_FRONT.PRICING,
      hint: tNav('hints.pricing'),
    },
    ...(appEntryMode === 'app'
      ? [
          {
            label: tNav('getApp'),
            href: ROUTES_FRONT.GET_APP,
            hint: tNav('hints.getApp'),
          },
        ]
      : []),
  ];

  /* ─── i18n: locale cycle PL → EN → DE → PL (SSOT: kernel getNextLocale) ─── */
  const currentLocale = (router.locale ??
    I18N_CONFIG.defaultLocale) as LocaleType;
  const cycleLocale = () => {
    const nextLocale = getNextLocale(currentLocale);
    // Only the route's verified reciprocal group can name a translated post.
    // Older ungrouped posts keep the index fallback instead of guessing a slug.
    if (router.pathname === ROUTES_FRONT.BLOG_POST) {
      const target = localePaths?.[nextLocale] ?? ROUTES_FRONT.BLOG;
      void runNavigationIntent(
        {
          policy: 'fade',
          scroll: 'reset',
          reason: 'locale-switch',
          targetPathname: target,
        },
        () =>
          router.push(target, target, {
            locale: nextLocale,
          })
      );
      return;
    }
    // NVT O2: locale switch = fade + preserved scroll + kept focus. Same
    // pathname, different locale prefix — targetPathname = the current
    // asPath (the seam strips query/locale), so the armed transition adopts
    // ONLY its own routeChangeStart (O20; target-less adoption is reserved
    // for popstate backs). The explicit `policy` also exempts this same-path
    // navigation from the FSM skip. `scroll: false` stops Next resetting the
    // window position; the FSM's 'preserve' mode owns scroll.
    void runNavigationIntent(
      {
        policy: 'fade',
        scroll: 'preserve',
        reason: 'locale-switch',
        targetPathname: router.asPath,
      },
      () =>
        router.push(
          { pathname: router.pathname, query: router.query },
          router.asPath,
          { locale: nextLocale, scroll: false }
        )
    );
  };

  /* ─── Scroll-aware compact AppBar (rAF-throttled) ─── */
  const headerRef = useRef<HTMLDivElement>(null);
  usePublicHeaderHeight(headerRef);

  // Desktop: the bar is compact whenever the page is not at the very top. Phone: compact only
  // while scrolling DOWN; a deliberate scroll up restores full height together with the
  // floating button (DECISION and thresholds in shared/scroll/scroll-intent.ts).
  // `data-scrolled` separately means "page is not at the top": it slides in the contact bubble,
  // which must not vanish on every upward move.
  const scroll = useScrollIntent();
  const isCompact = scroll.isNarrow
    ? scroll.isPastTop && scroll.intent === 'down'
    : scroll.isPastTop;

  /* ─── Scroll-reveal IntersectionObserver ─── */
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset['revealed'] = 'true';
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    const observeAll = () => {
      document
        .querySelectorAll<HTMLElement>(
          '[data-scroll-reveal]:not([data-revealed])'
        )
        .forEach(el => observer.observe(el));
    };

    observeAll();

    // Re-observe on DOM changes (route transitions, conditional rendering).
    // Coalesce mutations into a single rAF tick — without this the callback
    // fires on every React reconciliation (interactive lists, toggles), each
    // running a full querySelectorAll across <body>.
    let rafId: number | null = null;
    const mo = new MutationObserver(() => {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        observeAll();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mo.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <div className={styles.layout}>
      {/* Skip link (WCAG 2.4.1) */}
      <a href='#main-content' className={styles.skipLink}>
        {t('skipToContent')}
      </a>

      {/* Maintenance and announcements ride inside the sticky header so they
          stay above the nav instead of pinning over it. */}
      <div
        ref={headerRef}
        className={styles.appBarWrapper}
        data-compact={isCompact || undefined}
        data-scrolled={scroll.isPastTop || undefined}>
        <MaintenanceBannerMolecule />
        <AnnouncementBannerOrganism surface='public' />
        {/* The app exit lives INSIDE the sticky header, not beside it: two `sticky; top: 0`
         * siblings with the same z-index pin to the same spot and the later one in the DOM
         * (AppBar) paints over the earlier, so after scrolling one bar height the „Wróć do
         * aplikacji" link hid under the bar (measured with elementFromPoint). */}
        <AppReturnBarMolecule />
        <AppBarOrganism
          className={styles.appBar}
          logo={
            <Link
              href={ROUTES_FRONT.HOME}
              className={styles.logoLink}
              aria-current={
                router.pathname === ROUTES_FRONT.HOME ? 'page' : undefined
              }>
              <BrandLockupMolecule markClassName={styles.logoMark} />
            </Link>
          }
          links={PUBLIC_NAV_LINKS}
          activeHref={router.pathname}
          actions={
            <>
              <LanguageSwitcher current={currentLocale} onCycle={cycleLocale} />
              {/* Auth-aware: login CTA when logged out, avatar + dropdown when in */}
              <HeaderUserMenuOrganism />
            </>
          }
          mobileActions={
            <>
              <LanguageSwitcher current={currentLocale} onCycle={cycleLocale} />
              <MobilePanelCta />
            </>
          }
          mobileTopAction={<MobileAccountAvatarOrganism />}
        />
      </div>

      {/* Main content (pages own their padding/max-width) */}
      {/* D1-F3: per-layout boundary isolates public-page content errors from
       * the layout chrome (AppBar, footer). The global boundary in _app.tsx
       * catches everything else; this one scopes recovery to just the main slot. */}
      <main id='main-content' className={styles.content}>
        <NavigationContentShellComposition>
          <ErrorBoundaryComposition
            fallbackTitle={errorCopy.title}
            fallbackAction={errorCopy.action}
            fallbackHomeAction={errorCopy.home}>
            {children}
          </ErrorBoundaryComposition>
        </NavigationContentShellComposition>
      </main>

      <PublicFooterOrganism />
      <SupportFloatingButtonOrganism />
    </div>
  );
}

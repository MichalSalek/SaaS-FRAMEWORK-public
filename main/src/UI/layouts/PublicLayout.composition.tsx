import { usePublicHeaderHeight } from '../shared/hooks/usePublicHeaderHeight';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
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
import { useAppEntryMode } from '../shared/hooks/useAppEntryMode';
import { SupportFloatingButtonOrganism } from '../components/SupportFloatingButton/SupportFloatingButton.organism';
import { useRafThrottledScroll } from '../hooks/useRafThrottledScroll';
import { useScrollDepth } from '../hooks/useScrollDepth';
import { useInternalLinkTracking } from '../hooks/useInternalLinkTracking';
import { PublicFooterOrganism } from './PublicFooter.organism';
import { AnnouncementBannerOrganism } from '../features/announcements/AnnouncementBanner.organism';
import { MaintenanceBannerMolecule } from '../features/maintenance/MaintenanceBanner.molecule';
import { ErrorBoundaryComposition } from '../components/ErrorBoundary.composition';
import { NavigationContentShellComposition } from './NavigationContentShell.composition';
import { runNavigationIntent } from '../../application/routing/navigation.possibilities.api';
import { AppReturnBarMolecule } from './PublicLayout.returnBar.molecule';
import styles from './PublicLayout.module.css';

/* ─── Types ─── */

export interface PublicLayoutProps {
  children: ReactNode;
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

/* ─── MobilePanelCta — drawer action (user 2026-06-25): zalogowany → „Idź do
 *     panelu" (/app), wylogowany → „Zaloguj się". Zastępuje avatar-dropdown
 *     konta w hamburger-overlay na mobile (mniej zagnieżdżenia). ─── */
function MobilePanelCta() {
  const t = useTranslations('layout.public');
  const hasLiveSession = useHasLiveAccountSession();
  const [mounted, setMounted] = useState(false);
  // DECISION (nie usuwaj): mounted-gate jak w HeaderUserMenu —
  // useHasLiveAccountSession czyta token z localStorage + sesję BA (null na
  // serwerze), więc SSR/pierwszy render = login CTA; swap na „Idź do panelu"
  // dopiero po hydracji (zero hydration mismatch). Gate na ŻYWEJ sesji (nie sam
  // token) — stale/wygasły token pokazuje „Zaloguj się", nie martwy panel-link
  // dead-endujący na /user/login (S37 repro).
  useEffect(() => {
    setMounted(true);
  }, []);
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
export function PublicLayoutComposition({ children }: PublicLayoutProps) {
  const router = useRouter();
  const t = useTranslations('layout.public');
  const tNav = useTranslations('nav');
  const tErrors = useTranslations('errors');

  // Głębokość czytania stron publicznych. Wpięte w layout, nie w poszczególne
  // kompozycje: dziewięć stron statycznych dzieli ten sam layout, a pomiar
  // dopinany ręcznie na każdej z nich rozjechałby się przy pierwszej nowej.
  useScrollDepth();
  // Krawędzie grafu przejść — czym dokładnie ktoś poszedł dalej.
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
    // A blog post exists in ONE language (Polish today): swapping only the
    // locale prefix lands on a 404. Send the reader to the blog index in the
    // language she picked instead — it says the articles are on the way.
    if (router.pathname === ROUTES_FRONT.BLOG_POST) {
      void runNavigationIntent(
        {
          policy: 'fade',
          scroll: 'reset',
          reason: 'locale-switch',
          targetPathname: ROUTES_FRONT.BLOG,
        },
        () =>
          router.push(ROUTES_FRONT.BLOG, ROUTES_FRONT.BLOG, {
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

  const handleScroll = useCallback((scrollY: number) => {
    const header = headerRef.current;
    if (!header) {
      return;
    }
    if (scrollY > 50) {
      header.dataset['compact'] = 'true';
    } else {
      delete header.dataset['compact'];
    }
  }, []);

  useRafThrottledScroll(handleScroll);

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

      {/* Maintenance banner — highest-priority strip, above announcements, sticky */}
      <MaintenanceBannerMolecule />

      {/* Announcement banner — above header, sticky */}
      <AnnouncementBannerOrganism />

      {/* Header (scroll-aware compact wrapper) */}
      <div ref={headerRef} className={styles.appBarWrapper}>
        {/* Wyjście do apki mieszka WEWNĄTRZ przyklejonego nagłówka, nie obok
         * niego: dwa rodzeństwa `sticky; top: 0` z tym samym z-indexem pinują
         * się w to samo miejsce, a późniejsze w DOM (AppBar) po prostu zamalowuje
         * wcześniejsze — po przewinięciu o wysokość paska link „Wróć do
         * aplikacji" znikał pod belką, czyli dokładnie w scenariuszu, przed
         * którym ma chronić (zmierzone elementFromPoint, nie oszacowane). */}
        <AppReturnBarMolecule />
        <AppBarOrganism
          className={styles.appBar}
          logo={
            <Link href={ROUTES_FRONT.HOME} className={styles.logoLink}>
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
            fallbackTitle={tErrors('unexpectedError')}
            fallbackAction={tErrors('tryAgain')}
            fallbackHomeAction={tErrors('backToHome')}>
            {children}
          </ErrorBoundaryComposition>
        </NavigationContentShellComposition>
      </main>

      <PublicFooterOrganism />
      <SupportFloatingButtonOrganism />
    </div>
  );
}

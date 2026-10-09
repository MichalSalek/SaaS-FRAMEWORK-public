import {
  type ReactNode,
  type CSSProperties,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { AppLinkAtom as Link } from '../AppLink/AppLink.atom';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { ListIcon, XIcon } from '@phosphor-icons/react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './AppBar.module.css';

/* ─── Types ─── */

export interface AppBarLink {
  label: string;
  href: string;
  /** Jednozdaniowy podpis „dla kogo / po co" pod etykietą (głos S111 C). */
  hint?: string;
}

export interface AppBarProps {
  logo?: ReactNode;
  links?: AppBarLink[];
  actions?: ReactNode;
  /**
   * Optional override for the mobile hamburger-overlay action slot. Falls back
   * to `actions` when omitted. Lets the public header show a simple "go to
   * panel" / login CTA inside the drawer instead of the full account
   * avatar-dropdown that lives in the desktop top-bar.
   */
  mobileActions?: ReactNode;
  /**
   * Optional slot rendered in the mobile TOP BAR, immediately LEFT of the
   * hamburger (desktop-hidden). The public header uses it for the logged-in
   * account avatar so a signed-in visitor reaches their account from the mobile
   * bar without opening the drawer (user 2026-06-25).
   */
  mobileTopAction?: ReactNode;
  /** Ścieżka bieżącej strony: link o tym `href` dostaje `aria-current="page"`. */
  activeHref?: string;
  className?: string;
  style?: CSSProperties;
}

/* ─── Component ─── */

export function AppBarOrganism({
  logo,
  links = [],
  actions,
  mobileActions,
  mobileTopAction,
  activeHref,
  className,
  style,
}: AppBarProps) {
  const t = useTranslations('components');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mobileOverlayRef = useRef<HTMLDivElement>(null);

  const toggleMenu = useCallback(() => {
    setMobileMenuOpen(prev => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  // ESC + Tab focus trap + focus save/restore (WCAG 2.4.3 / EAA). Keyboard
  // users must not tab behind the open menu, and focus must return to the
  // hamburger trigger on close. `'first-only'` = focus the first link (the
  // overlay itself is not a focus target); no fallback when empty, matching
  // the original inline copy.
  //
  // DECISION (nie usuwaj tego komentarza):
  // inert=false here, unlike the other 4 hand-rolled modals. AppBar's mobile
  // menu is a collapsing disclosure panel INSIDE <header> (height expand,
  // NOT role=dialog/aria-modal, NOT fullscreen) — its hamburger close button is
  // a DOM sibling within `.inner`. inertBackground() walks up from the overlay
  // and would inert `.inner`, disabling the very X button that closes the menu
  // (and is semantically wrong: a non-modal disclosure must not inert the page).
  // The other 4 are true fullscreen/portaled aria-modal dialogs where inert is
  // correct. Preserving the original (no inert) keeps behaviour 1:1.
  useFocusTrap(mobileOverlayRef, {
    active: mobileMenuOpen,
    onEscape: closeMenu,
    initialFocus: 'first-only',
    inert: false,
  });

  // Menu sięga do dołu ekranu od SWOJEJ górnej krawędzi, nie od wysokości paska:
  // nad paskiem mogą stać pasek „Wróć do aplikacji" (skorupa natywna), baner
  // ogłoszenia albo przerwy technicznej, a `100dvh - pasek` wypychało wtedy
  // dolne kafle poza ekran bez możliwości przewinięcia (nagłówek jest sticky).
  useEffect(() => {
    const overlay = mobileOverlayRef.current;
    if (!mobileMenuOpen || !overlay) {
      return;
    }
    const place = () => {
      overlay.style.setProperty(
        '--menu-top',
        `${Math.max(0, overlay.getBoundingClientRect().top)}px`
      );
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [mobileMenuOpen]);

  // Close on click outside
  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileMenuOpen, closeMenu]);

  return (
    <header
      className={clsx(styles.appBar, className)}
      style={style}
      ref={menuRef}>
      <div className={styles.inner}>
        {/* Logo */}
        {logo != null && <div className={styles.logo}>{logo}</div>}

        {/* Desktop nav */}
        <nav
          className={styles.desktopNav}
          aria-label={t('aria.mainNavigation')}>
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={styles.navLink}
              aria-current={link.href === activeHref ? 'page' : undefined}>
              <span className={styles.linkLabel}>{link.label}</span>
              {link.hint != null && (
                <span className={styles.linkHint}>{link.hint}</span>
              )}
            </Link>
          ))}
        </nav>

        {/* Desktop actions */}
        {actions != null && (
          <div className={styles.desktopActions}>{actions}</div>
        )}

        {/* Mobile account avatar — left of the hamburger (desktop-hidden) */}
        {mobileTopAction != null && (
          <div className={styles.mobileTopAction}>{mobileTopAction}</div>
        )}

        {/* Hamburger (mobile only) */}
        <button
          type='button'
          className={styles.hamburger}
          onClick={toggleMenu}
          aria-label={mobileMenuOpen ? t('aria.closeMenu') : t('aria.openMenu')}
          aria-expanded={mobileMenuOpen}>
          {mobileMenuOpen ? <XIcon size={22} /> : <ListIcon size={22} />}
        </button>
      </div>

      {/* Mobile overlay menu */}
      {/* DECISION (nie usuwaj tego komentarza):
          Zamknięte menu jest wygaszane przez `inert` na KONTENERZE, nie przez
          `tabIndex` na poszczególnych dzieciach. Zwinięte menu zostaje w DOM
          (height:0 + overflow:hidden, NIE display:none), więc wszystko
          w środku pozostaje fokusowalne. Wariant per-dziecko chronił tylko
          linki nawigacji, a slot akcji (przełącznik języka, CTA konta) zostawał
          w tab-orderze wewnątrz `aria-hidden='true'` — użytkownik klawiatury
          trafiał w niewidoczne kontrolki (WCAG 4.1.2). `inert` zdejmuje poddrzewo
          z tab-orderu I z drzewa dostępności naraz, więc zastępuje `aria-hidden`
          (trzymanie obu = dwa źródła prawdy, które potrafią się rozjechać) i nie
          wymaga pamiętania o guardzie przy dokładaniu kolejnego slotu.
          Od 1280px kontener i tak ma display:none. Fokus przy zamykaniu
          przywraca useFocusTrap (save/restore na trigger). */}
      <div
        ref={mobileOverlayRef}
        className={clsx(
          styles.mobileMenu,
          mobileMenuOpen && styles.mobileMenuOpen
        )}
        inert={!mobileMenuOpen}>
        <nav
          className={styles.mobileNav}
          aria-label={t('aria.mobileNavigation')}>
          {links.map(link => (
            <Link
              key={link.href}
              href={link.href}
              className={styles.mobileNavLink}
              aria-current={link.href === activeHref ? 'page' : undefined}
              onClick={closeMenu}>
              <span className={styles.linkLabel}>{link.label}</span>
              {link.hint != null && (
                <span className={styles.linkHint}>{link.hint}</span>
              )}
            </Link>
          ))}
        </nav>

        {/* DECISION (nie usuwaj): osobny `mobileActions` (fallback do `actions`)
            — w hamburger-drawerze na LP pokazujemy prosty CTA „Idź do panelu" /
            „Zaloguj się" zamiast pełnego avatar-dropdownu konta (mniej
            zagnieżdżenia; user 2026-06-25). Desktop top-bar zostaje na `actions`. */}
        {(mobileActions ?? actions) != null && (
          <div className={styles.mobileActions}>{mobileActions ?? actions}</div>
        )}
      </div>
    </header>
  );
}

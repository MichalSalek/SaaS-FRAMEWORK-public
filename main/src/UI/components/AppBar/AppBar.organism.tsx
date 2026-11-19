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
  /** One-sentence caption („for whom / what for") under the label. */
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
   * bar without opening the drawer.
   */
  mobileTopAction?: ReactNode;
  /** Path of the current page: the link with this `href` gets `aria-current="page"`. */
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
  const t = useTranslations('components.aria');
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
  // DECISION: inert is false here, unlike the other hand-rolled modals. The mobile menu is a
  // non-modal collapsing disclosure INSIDE <header>, and its close button is a DOM sibling within
  // `.inner`: inertBackground() would inert `.inner` and disable the very button that closes the
  // menu. The other modals are fullscreen/portaled aria-modal dialogs, where inert is correct.
  useFocusTrap(mobileOverlayRef, {
    active: mobileMenuOpen,
    onEscape: closeMenu,
    initialFocus: 'first-only',
    inert: false,
  });

  // The menu reaches the screen bottom from ITS OWN top edge, not from the bar height: above the
  // bar there can be the „Wróć do aplikacji" bar (native shell) or an announcement/maintenance
  // banner, and `100dvh - bar` would push the lower tiles off screen with no way to scroll (the
  // header is sticky).
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
        <nav className={styles.desktopNav} aria-label={t('mainNavigation')}>
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
          aria-label={mobileMenuOpen ? t('closeMenu') : t('openMenu')}
          aria-expanded={mobileMenuOpen}>
          {mobileMenuOpen ? <XIcon size={22} /> : <ListIcon size={22} />}
        </button>
      </div>

      {/* Mobile overlay menu */}
      {/* DECISION: the closed menu is silenced with `inert` on the CONTAINER, not `tabIndex` on each
          child. The collapsed menu stays in the DOM (height:0 + overflow:hidden, not display:none),
          so its contents stay focusable; per-child tabIndex covered only the nav links and left the
          actions slot (language switch, account CTA) tabbable inside aria-hidden (WCAG 4.1.2).
          `inert` removes the subtree from tab order and accessibility tree at once, so it replaces
          `aria-hidden` (two sources of truth drift) and needs no guard when a slot is added. Focus
          restore on close is handled by useFocusTrap. */}
      <div
        ref={mobileOverlayRef}
        className={clsx(
          styles.mobileMenu,
          mobileMenuOpen && styles.mobileMenuOpen
        )}
        inert={!mobileMenuOpen}>
        <nav className={styles.mobileNav} aria-label={t('mobileNavigation')}>
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

        {/* DECISION: `mobileActions` (falls back to `actions`) is separate because the landing-page
            hamburger drawer shows a plain "Idź do panelu" / "Zaloguj się" CTA instead of the full
            account avatar dropdown (less nesting); the desktop top bar keeps `actions`.
            (owner) */}
        {(mobileActions ?? actions) != null && (
          <div className={styles.mobileActions}>{mobileActions ?? actions}</div>
        )}
      </div>
    </header>
  );
}

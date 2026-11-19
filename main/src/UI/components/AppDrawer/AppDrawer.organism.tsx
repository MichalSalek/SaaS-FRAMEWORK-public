import { hasOwnSalon } from '../../../application/policies/salon-ownership.policy';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { AppLinkAtom as Link } from '../AppLink/AppLink.atom';
import { XIcon } from '@phosphor-icons/react';
import clsx from 'clsx';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import type { UserRole, DrawerSection } from './appDrawerSections';
import {
  getStylistSections,
  getClientSections,
  getAdminSections,
  getGuestSections,
  getRoleUnresolvedSections,
  withoutDiscoveryWhenDisabled,
} from './appDrawerSections';
import { useScrollLock } from '../../hooks/useScrollLock';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { useAuth } from '../../contexts/AuthContext.composition';
import { getSupportUnreadCount_IO } from '../../../domain/support/supportIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { markGlobalNavigation } from '../../../application/routing/screen-arrival';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { AppDrawerRowsOrganism } from './AppDrawer.rows.organism';
import styles from './AppDrawer.module.css';

/* ─── Types ─── */

interface AppDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  role: UserRole | null;
  /** Role not chosen yet (onboarding before the role step): no role label, no „Twój panel",
   *  only the exit (getRoleUnresolvedSections). */
  roleUnresolved?: boolean;
  isLoggedIn: boolean;
  userName?: string | undefined;
  /**
   * Number of unread messages: the badge on the „Wiadomości" item. Computed in the PARENT layer
   * (AppLayout, useUnreadMessagesCount) and passed as a prop: AppDrawer is a component
   * (components/) and must not import a feature hook (components/ never imports features/).
   */
  unreadMessages?: number;
  /** Salon-team invitations entry (contract in appDrawerSections:
   *  n > 0 = item with badge, null = item without badge after a failed read,
   *  0 = no item). Derived in AppLayout for the same layering reason as
   *  unreadMessages. */
  salonInvitations?: number | null;
}

// display:contents — the shell adds no box, so the fixed-positioned backdrop +
// panel inside keep their exact layout; it exists only as the inert anchor.
const SHELL_STYLE = { display: 'contents' } as const;

/* ─── Component ─── */

export function AppDrawerOrganism({
  isOpen,
  onClose,
  role,
  roleUnresolved = false,
  isLoggedIn,
  userName,
  unreadMessages = 0,
  salonInvitations = 0,
}: AppDrawerProps) {
  const router = useRouter();
  const nav = useNativeRouter();
  const tRaw = useTranslations();
  const { logout } = useAuth();
  // SALON_STAFF_ENABLED kill-switch — hides the Salon nav section when off. Non-public
  // flag, so this resolves to FEATURE_FLAG_DEFAULTS (=true); the route gate + back-guard
  // are the real enforcement (see appDrawerSections / salon/staff handlers).
  const salonStaffEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED
  );
  // Cold start: EXPLORE_ENABLED=false hides discovery from the drawer (see the helper).
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  const drawerRef = useRef<HTMLElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // SSR/CSR hydration guard — isLoggedIn comes from auth store (localStorage).
  // On the server it is always false (no window), on the client it may be true.
  // Rendering auth-conditional JSX before hydration completes causes a React
  // Hydration Error (server tree ≠ client tree). We defer auth-dependent nodes
  // until the first client-side effect has run, at which point the DOM matches.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  // Unread support replies — badge on „Pomoc”. Fetched only while the drawer
  // is open, for a signed-in stylist or client (the admin and guest menus have
  // no „Pomoc” entry of this kind). Same cache entry as the feature hook
  // `useSupportUnreadCount` (queryKeys.support.unreadCount); the query is
  // inlined because components/ may not import from features/ (imports-health).
  const isRoleMenu = role === 'stylist' || role === 'client';
  const { data: unreadSupport = 0 } = useQuery({
    queryKey: queryKeys.support.unreadCount,
    queryFn: ({ signal }) => getSupportUnreadCount_IO(undefined, { signal }),
    select: response => response.unread_threads,
    enabled: isOpen && isLoggedIn && !roleUnresolved && isRoleMenu,
    staleTime: 60_000,
  });

  // Scroll-lock the body while the drawer is open (shared counter — plays
  // nicely with other simultaneously-open overlays).
  useScrollLock(isOpen);

  // ESC + Tab focus trap + focus save/restore + background inert
  // (WCAG 2.4.3 / 4.1.2 / EAA). `'container'` = focus the drawer panel itself
  // (tabIndex -1) so keyboard users land inside.
  //
  // inertRef=shellRef (not the panel): the dimmed backdrop is a DOM sibling of
  // the panel and carries onClick={onClose}. Anchoring the inert walk at the
  // shell wrapper inerts the page BEHIND the shell while keeping both backdrop
  // (click-to-close) and panel interactive. The shell is display:contents so it
  // adds no box — backdrop/panel keep their position:fixed layout unchanged.
  // aria-modal-focus-trap-allow: the drawer is a side panel with a swipe-to-close gesture, a
  // display:contents shell and a separate clickable backdrop (inertRef). It does not fit the
  // fullscreen/backdrop variants of AppModalShell; its own useFocusTrap anchors inert on shellRef
  // so the backdrop stays interactive, which the shell does not model.
  useFocusTrap(drawerRef, {
    active: isOpen,
    onEscape: onClose,
    initialFocus: 'container',
    inert: true,
    inertRef: shellRef,
  });

  // Close FIRST, then navigate through the NVT hook channel: the
  // focus trap must be released BEFORE the transition starts (no trap may hang
  // on exiting content), and useNativeRouter gives the full exit-first grade.
  const handleNavigate = useCallback(
    (path: string) => {
      onClose();
      // The menu switches place, it is not a step deeper (screen-arrival.ts).
      markGlobalNavigation();
      nav.push(path);
    },
    [nav, onClose]
  );

  // Swipe right closes the panel (the shared product gesture, see UI/hooks/useSwipeDismiss.ts);
  // only the direction and the dimmed backdrop live here.
  useSwipeDismiss({
    targetRef: drawerRef,
    backdropRef: overlayRef,
    direction: 'right',
    onDismiss: onClose,
    enabled: isOpen,
  });

  const { data: currentUser } = useCurrentUserAccount();
  const ownAccount = currentUser?.stylist_account;
  const salonOwner = hasOwnSalon(ownAccount);

  const t = useCallback(
    (key: string): string => tRaw.raw(key) as string,
    [tRaw]
  );

  // Use guest sections until hydration completes — ensures SSR and initial
  // client render emit identical HTML (both see isLoggedIn=false / not hydrated).
  const sections = useMemo<DrawerSection[]>(() => {
    let base: DrawerSection[];
    if (!isHydrated || !isLoggedIn) {
      base = getGuestSections(t);
    } else if (roleUnresolved) {
      base = getRoleUnresolvedSections(t, logout);
    } else if (role === 'admin') {
      base = getAdminSections(t, logout);
    } else if (role === 'stylist') {
      base = getStylistSections(
        t,
        logout,
        salonStaffEnabled,
        unreadMessages,
        salonInvitations,
        unreadSupport,
        salonOwner
      );
    } else {
      base = getClientSections(
        t,
        logout,
        unreadMessages,
        salonInvitations,
        unreadSupport
      );
    }
    return withoutDiscoveryWhenDisabled(base, exploreEnabled);
    // handleNavigate/onClose are not dependencies: the memo does not read them, and `onClose`
    // changes identity on every parent render, which would recompute all sections for nothing.
  }, [
    isHydrated,
    isLoggedIn,
    role,
    roleUnresolved,
    t,
    logout,
    salonStaffEnabled,
    exploreEnabled,
    unreadMessages,
    salonInvitations,
    unreadSupport,
    salonOwner,
  ]);

  const roleLabel =
    role === 'stylist'
      ? t('drawer.roleStylist')
      : role === 'admin'
        ? t('drawer.roleAdmin')
        : t('drawer.roleClient');

  return (
    // Shell wrapper (display:contents — no box, fixed children unchanged): the
    // inert anchor for useFocusTrap, so the page behind goes inert while the
    // backdrop + panel inside stay interactive.
    <div ref={shellRef} style={SHELL_STYLE}>
      {/* Overlay */}
      {/* No onKeyDown: the dimmed backdrop has no tabIndex or children, so it never gets focus or
          a bubbled keyboard event, and an Escape handler here would be dead. Escape is handled by
          `useFocusTrap` (onEscape) above, on the whole panel. */}
      <div
        ref={overlayRef}
        className={clsx(styles.overlay, {
          [styles.overlayVisible ?? '']: isOpen,
        })}
        onClick={onClose}
        role='presentation'
      />

      {/* Drawer panel */}
      <aside
        ref={drawerRef}
        className={clsx(styles.drawer, { [styles.drawerOpen ?? '']: isOpen })}
        role='dialog'
        // Kept mounted and only translated off-screen when closed, so without
        // `inert` every menu item stayed in the Tab order (keyboard focus
        // vanished into an invisible panel after the tab bar) and screen
        // readers saw a permanently open modal. Closed = inert + not modal.
        aria-modal={isOpen ? 'true' : undefined}
        inert={!isOpen}
        aria-label={t('drawer.navLabel')}
        tabIndex={-1}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.sessionInfo}>
            <span className={styles.sessionName}>
              {userName ?? t('drawer.guest_name')}
            </span>
            {isHydrated && isLoggedIn && !roleUnresolved && (
              <span className={styles.sessionRole}>{roleLabel}</span>
            )}
          </div>
          <button
            type='button'
            className={styles.closeButton}
            onClick={onClose}
            aria-label={t('drawer.closeMenu')}>
            <XIcon size={18} />
          </button>
        </div>

        {/* DECISION: the menu draws the shared NavRow (cells in white groups); the earlier drawer
            items read as a text list with icons where only the arrows said "link". Do not go back
            to drawer-specific buttons. (owner)
            "Twój panel" is not shown for admin: their home is "Panel administratora", the first
            item of the admin section (see appDrawerSections.admin.tsx). */}
        <AppDrawerRowsOrganism
          sections={sections}
          dashboardLabel={
            isHydrated && isLoggedIn && role !== 'admin' && !roleUnresolved
              ? t('drawer.dashboard')
              : null
          }
          pathname={router.pathname}
          onNavigate={handleNavigate}
          badgeAriaLabel={t('drawer.unreadBadge')}
        />

        {/* Footer: a clickable return to the landing page */}
        <div className={styles.footer}>
          <Link
            href={ROUTES_FRONT.HOME}
            className={styles.footerBrand}
            onClick={onClose}>
            {tRaw('drawer.goToLandingPage', {
              domain: BRAND_CONFIG.domain.toUpperCase(),
            })}
          </Link>
          <div className={styles.divider} />
          <span className={styles.footerVersion}>
            v{process.env.NEXT_PUBLIC_BUILD_VERSION}
          </span>
        </div>
      </aside>
    </div>
  );
}

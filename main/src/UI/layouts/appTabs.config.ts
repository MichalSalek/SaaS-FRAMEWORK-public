import {
  CameraPlusIcon,
  FileTextIcon,
  GearIcon,
  HeartIcon,
  ImageIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PulseIcon,
  QrCodeIcon,
  ImagesIcon,
  SquaresFourIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { AppRole } from './useAppRole';

/* ─── Bottom-tab definitions per role (SSOT: ROUTES_FRONT) ─── */

type BottomNavKey =
  | 'dashboard'
  | 'myGallery'
  | 'qrCode'
  | 'addPhoto'
  | 'more'
  | 'sessions'
  | 'myFavorites'
  | 'explore'
  | 'pairing';

type AdminLayoutKey =
  'tabDashboard' | 'tabUsers' | 'tabLogs' | 'tabConfig' | 'tabHealth';

export interface BottomTabConfigKeyed {
  bottomNavKey?: BottomNavKey;
  adminKey?: AdminLayoutKey;
  /** Absent only on a `placeholder` slot. */
  icon?: Icon;
  /** An inert slot that keeps the bar's geometry (UNRESOLVED_TABS). */
  placeholder?: boolean;
  path?: string;
  isDrawerToggle?: boolean;
  elevated?: boolean;
}

// DECISION: the raised centre tab is the stylist's most frequent action, adding
// a work; the QR code (shown once per new client) is the fourth tab, still one
// tap away. The disc carries `CameraPlusIcon` so the icon says what it adds (a
// bare plus was rejected). Disc shape: DECISION in BottomTabBar.module.css. A
// blind test of alternative bar layouts (clients or sessions in place of the QR
// tab) scored below this one, so do not swap tabs without a new test.
// (owner)
export const STYLIST_TABS: ReadonlyArray<BottomTabConfigKeyed> = [
  { bottomNavKey: 'dashboard', icon: SquaresFourIcon, path: ROUTES_FRONT.APP },
  { bottomNavKey: 'myGallery', icon: ImageIcon, path: ROUTES_FRONT.GALLERY },
  {
    bottomNavKey: 'addPhoto',
    icon: CameraPlusIcon,
    path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
    elevated: true,
  },
  { bottomNavKey: 'qrCode', icon: QrCodeIcon, path: ROUTES_FRONT.PAIRING },
  { bottomNavKey: 'more', icon: ListIcon, isDrawerToggle: true },
];

// Cold-start CLIENT tabs: "Sesje" (browse) is shown by default.
// DECISION: EXPLORE_ENABLED is OFF by default (kernel config). The wiring is
// live (AppLayout reads the runtime flag), so the „Odkrywaj” tab replaces
// „Sesje” only once an admin turns the flag on; /app/explore also 404s via its
// getStaticProps gate while the flag is off.
export const CLIENT_TABS_BASE: ReadonlyArray<BottomTabConfigKeyed> = [
  { bottomNavKey: 'dashboard', icon: SquaresFourIcon, path: ROUTES_FRONT.APP },
  {
    bottomNavKey: 'sessions',
    // CLIENT_SESSIONS directly: /app/shared is the STYLIST's inbox and would only redirect
    // the client (and after the redirect the tab lost its active state).
    // The same pictogram as the „Sesje” row on her profile (a set of
    // photos). The share-nodes glyph told a first-contact reader nothing.
    icon: ImagesIcon,
    path: ROUTES_FRONT.CLIENT_SESSIONS,
  },
  {
    bottomNavKey: 'myFavorites',
    icon: HeartIcon,
    path: ROUTES_FRONT.FAVORITES,
  },
  { bottomNavKey: 'pairing', icon: QrCodeIcon, path: ROUTES_FRONT.PAIRING },
  { bottomNavKey: 'more', icon: ListIcon, isDrawerToggle: true },
];

const EXPLORE_TAB: BottomTabConfigKeyed = {
  bottomNavKey: 'explore',
  icon: MagnifyingGlassIcon,
  path: ROUTES_FRONT.EXPLORE,
};

// When EXPLORE_ENABLED is on, the discovery feed replaces the "Sesje" tab.
export function getClientTabs(
  exploreEnabled: boolean
): ReadonlyArray<BottomTabConfigKeyed> {
  if (!exploreEnabled) {
    return CLIENT_TABS_BASE;
  }
  return CLIENT_TABS_BASE.map(tab =>
    tab.bottomNavKey === 'sessions' ? EXPLORE_TAB : tab
  );
}

export const ADMIN_TABS: ReadonlyArray<BottomTabConfigKeyed> = [
  { adminKey: 'tabDashboard', icon: SquaresFourIcon, path: ROUTES_FRONT.ADMIN },
  { adminKey: 'tabUsers', icon: UsersIcon, path: ROUTES_FRONT.ADMIN_USERS },
  { adminKey: 'tabLogs', icon: FileTextIcon, path: ROUTES_FRONT.ADMIN_LOGS },
  { adminKey: 'tabConfig', icon: GearIcon, path: ROUTES_FRONT.ADMIN_CONFIG },
  { adminKey: 'tabHealth', icon: PulseIcon, path: ROUTES_FRONT.ADMIN_HEALTH },
];

// DECISION: while the active role is unknown (`useAppRole().isRoleResolved`
// false) the bar shows only the two items shared by both roles plus three inert
// slots, never the client bar (a stylist got client tabs and 403s). Five slots
// because both role bars have five, so nothing shifts when the role arrives.
export const UNRESOLVED_TABS: ReadonlyArray<BottomTabConfigKeyed> = [
  { bottomNavKey: 'dashboard', icon: SquaresFourIcon, path: ROUTES_FRONT.APP },
  { placeholder: true },
  { placeholder: true },
  { placeholder: true },
  { bottomNavKey: 'more', icon: ListIcon, isDrawerToggle: true },
];

export function getTabsForRole(
  role: AppRole | null,
  exploreEnabled: boolean
): ReadonlyArray<BottomTabConfigKeyed> {
  if (role === null) {
    return UNRESOLVED_TABS;
  }
  switch (role) {
    case 'stylist':
      return STYLIST_TABS;
    case 'admin':
      return ADMIN_TABS;
    case 'client':
    default:
      return getClientTabs(exploreEnabled);
  }
}

/**
 * Whether `pathname` is a TAB ROOT for the given tab set: `/app` or a route that
 * is itself a bottom-tab destination of the current role.
 *
 * DECISION: a tab root has no in-app back; the tab bar is its navigation, so
 * the AppBar shows the same trigger and title as `/app`. The role's tab config
 * is the SSOT of roots; `/app` is a root for every role (the admin set lacks
 * it). Exact match only: a screen below a tab keeps its back. With
 * UNRESOLVED_TABS every path counts as a root: a „Wróć” that flashes and
 * vanishes is worse than one that arrives with the role. (Link arrivals from
 * deeper screens are handled in useCanGoBack.)
 */
export function isTabRootPath(
  tabs: ReadonlyArray<BottomTabConfigKeyed>,
  pathname: string
): boolean {
  return (
    pathname === ROUTES_FRONT.APP ||
    tabs.some(
      tab =>
        tab.placeholder === true ||
        (tab.path !== undefined && tab.path === pathname)
    )
  );
}

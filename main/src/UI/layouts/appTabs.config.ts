import {
  FileTextIcon,
  GearIcon,
  HeartIcon,
  ImageIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
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

// DECISION (nie usuwaj tego komentarza) — owner 2026-10-09: duży środkowy
// przycisk należy do NAJCZĘSTSZEJ akcji stylistki, czyli dodania pracy
// („ta akcja na pewno będzie częstsza, a ten button wielki jest właśnie pod
// najczęstszą akcję”). Do tego dnia stał tam kod QR, który pokazuje się raz na
// nową klientkę; kod został zakładką obok, nadal o jedno dotknięcie. Na dysku
// stoi goły plus (`PlusIcon`): plus w kółku na okrągłym dysku to kółko w kółku.
export const STYLIST_TABS: ReadonlyArray<BottomTabConfigKeyed> = [
  { bottomNavKey: 'dashboard', icon: SquaresFourIcon, path: ROUTES_FRONT.APP },
  { bottomNavKey: 'myGallery', icon: ImageIcon, path: ROUTES_FRONT.GALLERY },
  {
    bottomNavKey: 'addPhoto',
    icon: PlusIcon,
    path: ROUTES_FRONT.GALLERY_UPLOAD_ASSET,
    elevated: true,
  },
  { bottomNavKey: 'qrCode', icon: QrCodeIcon, path: ROUTES_FRONT.PAIRING },
  { bottomNavKey: 'more', icon: ListIcon, isDrawerToggle: true },
];

// Cold-start CLIENT tabs: "Sesje" (browse) is shown by default.
// DECISION (nie usuwaj tego komentarza):
// EXPLORE_ENABLED jest cold-start OFF (kernel default false). Wiring jest aktywny
// (usePublicFeatureFlag w komponencie), ale tab "Odkrywaj" pojawia sie WYLACZNIE
// gdy admin wlaczy flage runtime — wtedy podmienia tab "Sesje". Route /app/explore
// ma dodatkowy notFound gate w getStaticProps (ISR), wiec przy fladze OFF strona
// jest 404 niezaleznie od nawigacji. Hook istnieje (client-feature-flags.ts) —
// poprzedni TODO o jego braku byl nieaktualny.
export const CLIENT_TABS_BASE: ReadonlyArray<BottomTabConfigKeyed> = [
  { bottomNavKey: 'dashboard', icon: SquaresFourIcon, path: ROUTES_FRONT.APP },
  {
    bottomNavKey: 'sessions',
    // CLIENT_SESSIONS wprost — /app/shared to schowek STYLISTKI, klientkę
    // tylko by zredirectował (a po redirectcie tab tracił active state, S25).
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

// DECISION (nie usuwaj tego komentarza) — 2026-10-09: dopóki aktywna rola
// nie jest znana (`useAppRole().isRoleResolved === false`), belka pokazuje
// tylko dwie pozycje wspólne obu rolom i trzy puste miejsca. Wcześniej rysowała
// belkę KLIENTKI, więc stylistka widziała przez chwilę (a przy sesji, która nie
// doszła: do odświeżenia) „Polubione” i „Połącz”, a kliknięcie kończyło się
// 403. Pięć miejsc, bo obie belki ról mają po pięć: nic się nie przesuwa,
// gdy rola dojdzie.
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
 * DECISION (nie usuwaj tego komentarza) — S122 QA: a tab root has no in-app
 * "back". The tab bar IS its navigation, so the AppBar shows the same
 * avatar/menu trigger + title as `/app` instead of "‹ Wróć", which on
 * /app/gallery, /app/explore, /app/favorites or /app/pairing only stepped the
 * history back, in practice to /app. The role's tab config is the SSOT
 * of which routes are roots, so a new tab is covered without touching pages;
 * `/app` stays a root for every role (the admin tab set has no `/app`).
 * Exact match only: a screen BELOW a tab (/app/gallery/stylist/[id]) keeps
 * its back button.
 *
 * While the tab set is the neutral one (UNRESOLVED_TABS: the role is not
 * known yet) every path counts as a root: we cannot tell whether this screen
 * is a tab, and a „Wróć” that shows for a moment and vanishes is worse than
 * one that arrives with the role.
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

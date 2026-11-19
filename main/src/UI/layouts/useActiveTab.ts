import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { isTabRootPath, type BottomTabConfigKeyed } from './appTabs.config';
import { useScreenArrival } from './useScreenArrival';

/**
 * Resolve which tab path is "active" for the current route, using a
 * longest-known-prefix match — this stops `/app/gallery/upload-asset` from
 * also flagging the `/app/gallery` tab as active.
 *
 * Exception: ROUTES_FRONT.APP ('/app') matches ONLY exactly; as a prefix it caught EVERY
 * app subpage and the Dashboard lit up on unrelated screens (salon-staff, account, stylist
 * sessions). A pushed screen without its own tab matches no PATH (returns ''), and the bar then
 * lights „Więcej” (see `isTabLit` below).
 *
 * Pure function (no React) — unit-tested directly.
 */
export function resolveActiveTabPath(
  candidatePaths: readonly string[],
  matchPath: string
): string {
  return candidatePaths.filter(Boolean).reduce((best, candidate) => {
    if (matchPath === candidate) {
      return candidate;
    }
    if (
      candidate !== ROUTES_FRONT.APP &&
      matchPath.startsWith(candidate + '/') &&
      candidate.length > best.length
    ) {
      return candidate;
    }
    return best;
  }, '');
}

/**
 * Is this tab the lit one? Pure, unit-tested.
 *
 * DECISION: the place indicator is never empty. A screen that belongs to no tab
 * lives in the menu, so „Więcej” lights there (readers lost their place when
 * nothing was lit). Rules: an open drawer takes the highlight (one indicator at
 * a time); a tab with a path lights when `activePath` is its path; „Więcej” also
 * lights when no path matches.
 */
export function isTabLit(
  tab: { path?: string | undefined; isDrawerToggle?: boolean | undefined },
  activePath: string,
  drawerOpen: boolean
): boolean {
  if (tab.isDrawerToggle === true) {
    return drawerOpen || activePath === '';
  }
  if (drawerOpen) {
    return false;
  }
  return tab.path !== undefined && tab.path === activePath;
}

/**
 * The path of the tab to light: the tab whose route this is, else the tab her
 * chain of in-content links started from (a photo opened from „Galeria” keeps
 * „Galeria” lit), else '' (then „Więcej” lights, see `isTabLit`). Pure.
 */
export function resolveLitTabPath(
  candidatePaths: readonly string[],
  matchPath: string,
  originTabRoot: string | null
): string {
  const own = resolveActiveTabPath(candidatePaths, matchPath);
  if (own !== '') {
    return own;
  }
  return originTabRoot !== null && candidatePaths.includes(originTabRoot)
    ? originTabRoot
    : '';
}

/** Active-tab path for the current bottom-tab config + route. */
export function useActiveTab(
  tabsConfig: ReadonlyArray<BottomTabConfigKeyed>,
  matchPath: string
): string {
  // The trail knows which tab this screen was opened from (DECISION at
  // `originTabRoot` in application/routing/screen-arrival.ts).
  const arrival = useScreenArrival(
    matchPath,
    isTabRootPath(tabsConfig, matchPath)
  );
  return resolveLitTabPath(
    tabsConfig.map(tab => tab.path ?? ''),
    matchPath,
    arrival?.originTabRoot ?? null
  );
}

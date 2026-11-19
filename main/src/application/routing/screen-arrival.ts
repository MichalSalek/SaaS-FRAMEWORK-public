// main/src/application/routing/screen-arrival.ts
// How the current screen was reached, as far as this page load knows.
//
// DECISION: records, per history entry, WHERE the current screen was reached from, because the
// History API does not say (owner). Two consumers:
//  1. A bottom-tab root (e.g. Sessions, opened from "Twój profil") normally has no "Wróć", yet here
//     she arrived by an in-content link from a deeper screen and had no way back.
//  2. A public page ("Zobacz profil") has no tab bar or drawer; the return bar showed only in the
//     native shell, a dead end in the phone browser and the home-screen app.
// The record is per history entry (Next.js key in `history.state.key`: `push` creates one, `replace`
// keeps it). Memory is module-only: after a reload nothing is known and the screen behaves as before.
// GLOBAL navigation (bottom bar, drawer) switches place, it is not a step down;
// `markGlobalNavigation()` reports it right before the push.

export interface ScreenArrival {
  /** Route pattern of the screen (`router.pathname`). */
  path: string;
  /** Route pattern of the screen she came from; null = first screen of this
   *  page load, or unknown. */
  fromPath: string | null;
  /** The screen she came from was a bottom-tab root. */
  fromTabRoot: boolean;
  /** She got here through the tab bar or the drawer. */
  viaGlobalNavigation: boolean;
  /**
   * The bottom-tab root her current chain of in-content links started from
   * (the tab she is „in”), as a route pattern; null when the chain started in
   * the drawer or is unknown (a reload, a deep link).
   *
   * DECISION: a screen opened by a link from a tab (a photo from "Galeria", a client card from
   * the dashboard) used to light "Więcej" because it is no tab's root, while the tab she was in
   * went dark. The bar must show WHERE she is and how she returns: the tab keeps its stack and
   * "Więcej" lights only when she came from the menu or we do not know where from (owner).
   */
  originTabRoot: string | null;
}

interface LastScreen {
  path: string;
  isTabRoot: boolean;
  originTabRoot: string | null;
}

const arrivals = new Map<string, ScreenArrival>();
let lastScreen: LastScreen | null = null;
let globalNavigationPending = false;

function readHistoryKey(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('key' in state)) {
    return null;
  }
  return typeof state.key === 'string' ? state.key : null;
}

/** The tab bar or the drawer is about to navigate. */
export function markGlobalNavigation(): void {
  globalNavigationPending = true;
}

/**
 * Called by every layout once its screen is on (and again when what it knows
 * about the screen changes). Returns how this history entry was reached.
 */
export function noteScreen(
  path: string,
  isTabRoot: boolean,
  historyKey: string | null = readHistoryKey()
): ScreenArrival | null {
  let arrival: ScreenArrival | null = null;
  if (historyKey !== null) {
    const known = arrivals.get(historyKey);
    if (known !== undefined && known.path === path) {
      arrival = known;
    } else {
      // No record = a new entry (push): the last screen is where she came
      // from. A record for ANOTHER path = this entry was replaced (a finished
      // flow lands on its list): the screen it replaced is gone from history,
      // so „back” would not lead there and we claim no origin.
      const pushed = known === undefined;
      const cameFrom =
        pushed && lastScreen !== null && lastScreen.path !== path
          ? lastScreen
          : null;
      arrival = {
        path,
        fromPath: cameFrom?.path ?? null,
        fromTabRoot: cameFrom?.isTabRoot ?? false,
        viaGlobalNavigation: globalNavigationPending,
        originTabRoot: resolveOriginTabRoot(
          path,
          isTabRoot,
          globalNavigationPending,
          cameFrom
        ),
      };
      arrivals.set(historyKey, arrival);
    }
  }
  globalNavigationPending = false;
  lastScreen = {
    path,
    isTabRoot,
    originTabRoot: arrival?.originTabRoot ?? (isTabRoot ? path : null),
  };
  return arrival;
}

/** The tab root a new history entry belongs to (see `originTabRoot`). */
function resolveOriginTabRoot(
  path: string,
  isTabRoot: boolean,
  viaGlobalNavigation: boolean,
  cameFrom: LastScreen | null
): string | null {
  if (isTabRoot) {
    return path;
  }
  // The drawer is not a tab: a screen opened from it lives under „Więcej”.
  if (viaGlobalNavigation || cameFrom === null) {
    return null;
  }
  return cameFrom.originTabRoot;
}

/**
 * A tab root gets a back control only when she stepped INTO it from a deeper
 * screen by a link in the content: then the tab bar cannot take her back.
 */
export function cameFromDeeperScreen(arrival: ScreenArrival | null): boolean {
  return (
    arrival !== null &&
    arrival.fromPath !== null &&
    !arrival.fromTabRoot &&
    !arrival.viaGlobalNavigation
  );
}

/** She came to this screen from a screen of the given route prefix. */
export function cameFromRoutePrefix(
  arrival: ScreenArrival | null,
  prefix: string
): boolean {
  if (arrival === null || arrival.fromPath === null) {
    return false;
  }
  return (
    arrival.fromPath === prefix || arrival.fromPath.startsWith(`${prefix}/`)
  );
}

/** Test seam: forget everything. */
export function resetScreenArrivals(): void {
  arrivals.clear();
  lastScreen = null;
  globalNavigationPending = false;
}

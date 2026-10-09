import { useCallback, useEffect, useState } from 'react';
import { canGoBackNow } from '../../application/routing/navigation.possibilities.api';
import { cameFromDeeperScreen } from '../../application/routing/screen-arrival';
import { resolveBackFallback } from './appBackTargets.config';
import { isTabRootPath, type BottomTabConfigKeyed } from './appTabs.config';
import { useNativeRouter } from './useNativeRouter';
import { useScreenArrival } from './useScreenArrival';

/**
 * Whether the AppBar should show a Back button for the current route.
 * A tab root (`isTabRootPath` over the role's tab config) shows the
 * avatar/menu trigger like `/app` (DECISION in appTabs.config), with ONE
 * exception: she stepped into it from a deeper screen by a link in the
 * content, so the tab bar cannot take her back there (owner 2026-10-09,
 * DECISION in application/routing/screen-arrival.ts). Every other route shows
 * the control.
 *
 * DECISION (nie usuwaj — hydration fix): window.history.length jest niedostępne
 * w SSR (window undefined), więc gołe `typeof window` rozjeżdża się z pierwszym
 * client-renderem (Back vs placeholder) => "server HTML didn't match client" na
 * KAŻDEJ /app/* trasie (głośne tam, gdzie strona ma dodatkowy isLoading-flip).
 * Mount-gate: SSR i first-CSR renderują tę samą gałąź (bez Back), przycisk Back
 * pojawia się po zamontowaniu.
 */
export function useCanGoBack(
  tabs: ReadonlyArray<BottomTabConfigKeyed>,
  pathname: string
): boolean {
  const isTabRoot = isTabRootPath(tabs, pathname);
  const arrival = useScreenArrival(pathname, isTabRoot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  // S126: a sub-page always has a way up (history, or its logical parent:
  // appBackTargets.config), so the control shows on every route that is not a
  // tab root. Before, an empty history hid it and a deep-linked sub-page had
  // no visible exit to its list.
  return mounted && (!isTabRoot || cameFromDeeperScreen(arrival));
}

/**
 * The action of the AppBar back control: a real back when the history has an
 * entry to return to, otherwise a REPLACE to the route's logical parent (so a
 * second „Wróć” there does not bounce back into the page just left).
 *
 * Chromium's Navigation API knows the actual POSITION in history;
 * `history.length` also counts entries AFTER the current one, so after a
 * deep-link landing plus back it reads >1 although there is nowhere to go
 * (NVT A8). The length heuristic stays as the fallback where the API does not
 * exist (Safari, Firefox).
 */
export function useGoBack(pathname: string): () => void {
  const nav = useNativeRouter();
  return useCallback(() => {
    if (canGoBackNow() ?? window.history.length > 1) {
      nav.back();
    } else {
      nav.replace(resolveBackFallback(pathname));
    }
  }, [nav, pathname]);
}

import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { BottomTabConfigKeyed } from './appTabs.config';

/**
 * Resolve which tab path is "active" for the current route, using a
 * longest-known-prefix match — this stops `/app/gallery/upload-asset` from
 * also flagging the `/app/gallery` tab as active.
 *
 * Wyjątek: ROUTES_FRONT.APP ('/app') matchuje TYLKO exact — prefix łapał
 * KAŻDĄ podstronę appki i Dashboard świecił na obcych ekranach
 * (salon-staff, account, sesje stylistki itd.; census S25). Pushed-screen
 * bez własnego taba = żadna ŚCIEŻKA nie pasuje (zwracamy ''), a belka zapala
 * wtedy „Więcej” (patrz `isTabLit` niżej).
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
 * DECISION (nie usuwaj tego komentarza) — przegląd oczami użytkownika,
 * 2026-10-09: na ekranie, który nie należy do żadnej zakładki („Twoje
 * klientki”, „Sesje od klientek”, plan, ustawienia), nie świeciło się nic
 * i obie czytelniczki napisały, że gubią miejsce („no bottom tab is
 * highlighted, so I lose my place”). Takie ekrany mieszkają w menu, więc
 * belka zapala wtedy „Więcej”: wskaźnik miejsca nigdy nie jest pusty i mówi,
 * gdzie ten ekran znaleźć ponownie. Reguły:
 *  - otwarte menu przejmuje podświetlenie (jeden wskaźnik naraz);
 *  - zakładka ze ścieżką świeci, gdy `activePath` jest jej ścieżką;
 *  - „Więcej” świeci też wtedy, gdy żadna ścieżka nie pasuje.
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

/** Active-tab path for the current bottom-tab config + route. */
export function useActiveTab(
  tabsConfig: ReadonlyArray<BottomTabConfigKeyed>,
  matchPath: string
): string {
  return resolveActiveTabPath(
    tabsConfig.map(tab => tab.path ?? ''),
    matchPath
  );
}

// main/src/application/routing/screen-arrival.ts
// How the current screen was reached, as far as this page load knows.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-09, dwa zgłoszenia
// z telefonu („nie dam browser back()”):
//  1. „Twój profil” → wiersz „Sesje”: ekran Sesji jest zakładką dolnej belki,
//     a zakładka z zasady nie ma „Wróć” (DECISION w appTabs.config). Tyle że
//     ona tam nie przyszła z belki, tylko linkiem z głębszego ekranu, i nie
//     miała jak do niego wrócić.
//  2. „Twój publiczny profil” → „Zobacz profil”: strona publiczna nie ma belki
//     ani szuflady, a pasek powrotu pokazywał się wyłącznie w skorupie
//     natywnej. W przeglądarce telefonu i w aplikacji z ekranu głównego
//     (standalone, bez paska adresu) to była ślepa uliczka.
// Obie decyzje zależą od tego samego faktu, którego History API nie zdradza:
// SKĄD przyszła. Zapisujemy go więc sami, per wpis historii (klucz Next.js w
// `history.state.key`: `push` tworzy nowy, `replace` zachowuje bieżący).
// Pamięć jest tylko w module: po przeładowaniu strony nie wiemy nic i ekran
// zachowuje się jak dotąd (zakładka bez „Wróć”).
//
// Nawigacja GLOBALNA (dolna belka, szuflada) nie jest „wejściem z głębszego
// ekranu”: to przełączenie miejsca, nie krok w głąb. Zgłasza ją
// `markGlobalNavigation()` tuż przed pushem.

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
}

interface LastScreen {
  path: string;
  isTabRoot: boolean;
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
      };
      arrivals.set(historyKey, arrival);
    }
  }
  globalNavigationPending = false;
  lastScreen = { path, isTabRoot };
  return arrival;
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

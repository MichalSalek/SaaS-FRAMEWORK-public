import { createContext, useContext } from 'react';

/**
 * Cienki kanał: AppHero raportuje swoją widoczność (czy karta-intro jest w
 * polu widzenia u góry scrolla), a AppLayout decyduje, czy pokazać tytuł w
 * top-barze. Gdy AppHero jest widoczny, top-bar dubluje tytuł karty — więc
 * layout go wygasza; po przescrollowaniu karty tytuł top-bara wjeżdża
 * (wzorzec iOS large-title; głos ownera S27/2 = B).
 *
 * Kierunek zależności: kontekst żyje przy AppHero (warstwa components), a
 * AppLayout (warstwa layouts) go importuje — components NIE sięga w górę do
 * layouts. Poza AppLayout konsumpcja jest no-op (bezpieczna na każdej stronie
 * renderującej AppHero, wzorzec useAppBarTitle).
 */
export interface AppHeroVisibilityContextValue {
  reportVisible: (visible: boolean) => void;
  /**
   * Whether a hero is mounted on this screen at all (scrolled away or not).
   * The hero carries the screen's `<h1>`; a screen WITHOUT one gets its heading
   * from the top-bar title instead, so every screen has exactly one (S126).
   */
  reportPresent: (present: boolean) => void;
}

export const AppHeroVisibilityContext =
  createContext<AppHeroVisibilityContextValue | null>(null);

const noop = (): void => {};

/**
 * Zwraca callback raportujący widoczność AppHero do AppLayout. No-op, gdy
 * AppHero renderowany jest poza AppLayout (brak providera).
 */
export function useReportAppHeroVisibility(): AppHeroVisibilityContextValue['reportVisible'] {
  const ctx = useContext(AppHeroVisibilityContext);
  return ctx?.reportVisible ?? noop;
}

/** Callback reporting that a hero is mounted. No-op outside AppLayout. */
export function useReportAppHeroPresence(): AppHeroVisibilityContextValue['reportPresent'] {
  const ctx = useContext(AppHeroVisibilityContext);
  return ctx?.reportPresent ?? noop;
}

/**
 * Whether a top bar with the screen title sits above this component. True in
 * AppLayout's shell (phone and the desktop phone frame); false under the
 * desktop account layout, which has no bar (AppLayout hands it an empty
 * channel), and on any page outside AppLayout. A component that would
 * otherwise repeat the title (the process header) reads this, so a screen has
 * exactly ONE `<h1>`.
 */
export function useIsUnderAppBar(): boolean {
  return useContext(AppHeroVisibilityContext) !== null;
}

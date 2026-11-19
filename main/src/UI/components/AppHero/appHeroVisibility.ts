import { createContext, useContext } from 'react';

/**
 * A thin channel: AppHero reports its visibility (whether the intro card is in view at the top of
 * the scroll) and AppLayout decides whether to show the title in the top bar. While AppHero is
 * visible the top bar would duplicate the card's title, so the layout fades it; once the card
 * scrolls away the top-bar title slides in (iOS large-title pattern; owner).
 *
 * Dependency direction: the context lives next to AppHero (components layer) and AppLayout
 * (layouts layer) imports it; components never reach up into layouts. Outside AppLayout consuming
 * it is a no-op (safe on any page that renders AppHero, same pattern as useAppBarTitle).
 */
export interface AppHeroVisibilityContextValue {
  reportVisible: (visible: boolean) => void;
  /**
   * Whether a hero is mounted on this screen at all (scrolled away or not).
   * The hero carries the screen's `<h1>`; a screen WITHOUT one gets its heading
   * from the top-bar title instead, so every screen has exactly one.
   */
  reportPresent: (present: boolean) => void;
}

export const AppHeroVisibilityContext =
  createContext<AppHeroVisibilityContextValue | null>(null);

const noop = (): void => {};

/**
 * Returns the callback that reports AppHero's visibility to AppLayout. A no-op when AppHero is
 * rendered outside AppLayout (no provider).
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

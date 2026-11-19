import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { AppHeroVisibilityContextValue } from '../components/AppHero/appHeroVisibility';

/**
 * AppHero-aware AppBar title (owner). While the intro card (AppHero) carrying the same title is
 * visible, the top bar fades it; once the card scrolls away the title slides in (iOS
 * large-title). AppHero reports its visibility through context; pages without AppHero never
 * set suppressed=true.
 *
 * Returns `heroTitleSuppressed` (flag on `<header data-hero-title-hidden>`), `heroPresent`
 * (the screen has an intro card with its own `<h1>`) and `heroVisibilityValue` (provider value
 * for `AppHeroVisibilityContext`).
 */
export function useHeroTitleSuppression() {
  const router = useRouter();
  const [heroTitleSuppressed, setHeroTitleSuppressed] = useState(false);
  // A hero carries the screen's <h1>. Where none is mounted, the top-bar title
  // is the heading.
  const [heroPresent, setHeroPresent] = useState(false);
  const heroVisibilityValue = useMemo<AppHeroVisibilityContextValue>(
    () => ({
      reportVisible: setHeroTitleSuppressed,
      reportPresent: setHeroPresent,
    }),
    []
  );
  // Reset on route change: a new page shows the title by default until its AppHero (if any)
  // reports visibility; this prevents a stuck suppressed state on a screen without an intro card.
  //
  // "Adjust state during render" pattern (NOT a passive useEffect): an effect ran only AFTER
  // paint and CLOBBERED the child's synchronous report (useReportHeroVisibility, a
  // useLayoutEffect in AppHero, had already set suppressed=true before paint); the late reset
  // restored false and flashed the title on every navigation to a page with a hero.
  const [prevPath, setPrevPath] = useState(router.asPath);
  if (prevPath !== router.asPath) {
    setPrevPath(router.asPath);
    setHeroTitleSuppressed(false);
    setHeroPresent(false);
  }

  return { heroTitleSuppressed, heroPresent, heroVisibilityValue };
}

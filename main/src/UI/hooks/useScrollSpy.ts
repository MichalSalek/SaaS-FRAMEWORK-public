import { useEffect, useState } from 'react';

/**
 * Tracks the currently-visible section id from a list of element ids.
 *
 * Uses IntersectionObserver with a rootMargin shaped to fire when a section's
 * heading area enters the upper third of the viewport. The most recently
 * intersected id wins; if nothing is intersecting (e.g. very top of page),
 * the first id in the list is returned to keep TOC visually anchored.
 *
 * Passive — zero scroll listeners.
 */
export function useScrollSpy(
  ids: readonly string[],
  options?: { topOffset?: number }
): string {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? '');
  const topOffset = options?.topOffset ?? 96;

  useEffect(() => {
    if (typeof window === 'undefined' || ids.length === 0) {
      return;
    }

    const elements = ids
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) {
      return;
    }

    const visibility = new Map<string, number>();

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          visibility.set(entry.target.id, entry.intersectionRatio);
        });
        let bestId = ids[0];
        let bestRatio = -1;
        ids.forEach(id => {
          const ratio = visibility.get(id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        });
        if (bestRatio <= 0) {
          // Nothing in the spy zone — fall back to whichever section header is
          // closest above the viewport top (helps when sections are tall).
          let closestId = ids[0];
          let closestDelta = Number.POSITIVE_INFINITY;
          elements.forEach(el => {
            const top = el.getBoundingClientRect().top;
            const delta = topOffset - top;
            if (delta >= 0 && delta < closestDelta) {
              closestDelta = delta;
              closestId = el.id;
            }
          });
          setActiveId(closestId ?? ids[0] ?? '');
        } else {
          setActiveId(bestId ?? ids[0] ?? '');
        }
      },
      {
        // Track sections whose top crosses just below the sticky header zone.
        rootMargin: `-${topOffset}px 0px -55% 0px`,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      }
    );

    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [ids, topOffset]);

  return activeId;
}

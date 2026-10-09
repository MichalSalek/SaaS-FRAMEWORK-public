// UI/features/gallery/hooks/useGalleryReturnPosition.ts
// Coming BACK to a gallery list lands where the person left it, not at the top.
//
// DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
// The list position is remembered when the list unmounts and put back only
// when the page is entered by a BACK navigation (tapping „Galeria” in the tab
// bar is a fresh visit and starts at the top).
//  - Why on unmount and not on the card tap: a card navigates on its own in
//    the stylist gallery, and the exits are many (tap, tab bar, hardware
//    back). The layout cleanup runs in the commit that removes the list,
//    BEFORE NavigationTransitionController resets the scroller on
//    `routeChangeComplete`, so the value read there is still the list's.
//  - Why in an animation frame: that same reset runs right after the new page
//    commits (the router emits the event in a microtask), so a restore done in
//    the mount effect would be overwritten. A frame callback scheduled from a
//    layout effect runs after the reset and before the first paint.
//  - Why module memory and not sessionStorage: a reload starts at the top
//    anyway, and Explore's variant needs a branch inside the controller
//    (layouts), which this feature does not own.
// `ready` = the list has its final content (data in, filters replayed from the
// address); restoring earlier would clamp against a shorter page.

import { useLayoutEffect, useRef } from 'react';
import { useNavigationStore } from '../../../../application/stores/navigation.store';

const rememberedPositions = new Map<string, number>();

/** The position must hold this many frames in a row to count as restored. */
const RESTORE_HELD_FRAMES = 6;
/** Give up after about a second at 60 fps. */
const RESTORE_MAX_FRAMES = 60;

const getScroller = (): HTMLElement | null =>
  document.getElementById('main-content');

const readScrollTop = (): number => getScroller()?.scrollTop ?? window.scrollY;

const writeScrollTop = (top: number): void => {
  const scroller = getScroller();
  if (scroller) {
    scroller.scrollTop = top;
  } else {
    window.scrollTo({ top, behavior: 'auto' });
  }
};

export function useGalleryReturnPosition(key: string, ready: boolean): void {
  const enteredByBackRef = useRef(false);
  const startedRef = useRef(false);
  // `settled` = this mount shows the position the person should come back to.
  // Until then its scrollTop is NOT hers to remember: a back navigation mounts
  // the list twice (once while the old page is still leaving, once when the
  // route is ready), and the short-lived first mount used to overwrite the
  // remembered 1816 with its own 0 on the way out (measured S126).
  const settledRef = useRef(false);

  useLayoutEffect(() => {
    const { phase, direction } = useNavigationStore.getState();
    enteredByBackRef.current = phase !== 'idle' && direction === 'back';
    if (!enteredByBackRef.current) {
      rememberedPositions.delete(key);
      settledRef.current = true;
    }
    return () => {
      if (settledRef.current) {
        rememberedPositions.set(key, readScrollTop());
      }
    };
  }, [key]);

  useLayoutEffect(() => {
    if (!ready || startedRef.current || !enteredByBackRef.current) {
      return;
    }
    startedRef.current = true;
    const top = rememberedPositions.get(key);
    if (top === undefined || top <= 0) {
      rememberedPositions.delete(key);
      settledRef.current = true;
      return;
    }
    // One write is not enough: the controller's reset on `routeChangeComplete`
    // can run AFTER the first frame, and the grid may still be growing to its
    // full height. Keep putting the position back each frame until it has held
    // for a few frames or a second passed; the person's own touch, wheel or
    // key ends it at once.
    let frame = 0;
    let held = 0;
    let frames = 0;
    let finished = false;
    const detach = (): void => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('touchstart', finish);
      window.removeEventListener('wheel', finish);
      window.removeEventListener('keydown', finish);
    };
    function finish(): void {
      if (finished) {
        return;
      }
      finished = true;
      detach();
      rememberedPositions.delete(key);
      settledRef.current = true;
    }
    const tick = (): void => {
      frames += 1;
      if (Math.abs(readScrollTop() - top) > 2) {
        held = 0;
        writeScrollTop(top);
      } else {
        held += 1;
      }
      if (held >= RESTORE_HELD_FRAMES || frames >= RESTORE_MAX_FRAMES) {
        finish();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    window.addEventListener('touchstart', finish, { passive: true });
    window.addEventListener('wheel', finish, { passive: true });
    window.addEventListener('keydown', finish);
    frame = window.requestAnimationFrame(tick);
    // Unmounted mid-restore (the transient first mount): stop, but leave the
    // remembered position for the mount that follows.
    return detach;
  }, [key, ready]);
}

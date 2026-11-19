import { useEffect } from 'react';

// DECISION: the lock covers `document.body` AND `#main-content`. In the app shell the real
// scroller is `main#main-content` (the shell is overflow:hidden), so locking body alone was a
// no-op inside /app. The shared counter releases only when the last lock (modal over drawer)
// ends; inline overflow is reset to '' so the scroller's CSS class applies again.

let lockCount = 0;

const MAIN_CONTENT_ID = 'main-content';

function setScrollersOverflow(value: string): void {
  document.body.style.overflow = value;
  const mainScroller = document.getElementById(MAIN_CONTENT_ID);
  if (mainScroller instanceof HTMLElement) {
    mainScroller.style.overflow = value;
  }
}

export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    lockCount++;
    setScrollersOverflow('hidden');

    return () => {
      lockCount--;
      if (lockCount === 0) {
        setScrollersOverflow('');
      }
    };
  }, [active]);
}

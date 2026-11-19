export interface Position {
  main: number;
  x: number;
  y: number;
}

const RESTORE_TIMEOUT_MS = 10000;

export function restore(
  position: Position,
  onUser: () => void,
  onApplied: (reached: boolean) => void
): () => void {
  let stopped = false;
  let frame = 0;
  let observedMain: HTMLElement | null = null;
  const observedChildren = new Set<Element>();
  const apply = (): void => {
    if (stopped) {
      return;
    }
    const main = document.getElementById('main-content');
    if (main !== observedMain) {
      if (observedMain) {
        resize?.unobserve(observedMain);
      }
      observedChildren.forEach(child => resize?.unobserve(child));
      observedChildren.clear();
      observedMain = main;
      if (main) {
        resize?.observe(main);
      }
    }
    if (main) {
      for (const child of Array.from(main.children)) {
        if (!observedChildren.has(child)) {
          observedChildren.add(child);
          resize?.observe(child);
        }
      }
    }
    main?.scrollTo({ top: position.main, behavior: 'instant' });
    window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
    onApplied(
      (main?.scrollTop ?? 0) >= position.main - 2 &&
        window.scrollY >= position.y - 2
    );
  };
  const schedule = (): void => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(apply);
  };
  const observer = new MutationObserver(schedule);
  const resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  resize?.observe(document.documentElement);
  resize?.observe(document.body);
  const events = [
    'wheel',
    'touchstart',
    'touchmove',
    'pointerdown',
    'keydown',
  ] as const;
  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    observer.disconnect();
    resize?.disconnect();
    cancelAnimationFrame(frame);
    clearTimeout(timeout);
    events.forEach(event =>
      window.removeEventListener(event, handleUser, true)
    );
  };
  const handleUser = (event: Event): void => {
    if (event.type === 'wheel' || event.type === 'touchmove') {
      onUser();
    }
    stop();
  };
  events.forEach(event =>
    window.addEventListener(event, handleUser, { capture: true, passive: true })
  );
  const timeout = window.setTimeout(stop, RESTORE_TIMEOUT_MS);
  schedule();
  return stop;
}

/** A fresh screen starts instantly even when CSS enables smooth scrolling. */
export function resetRouteScroll(): void {
  const main = document.getElementById('main-content');
  if (main) {
    const previous = main.style.scrollBehavior;
    main.style.scrollBehavior = 'auto';
    main.scrollTop = 0;
    main.style.scrollBehavior = previous;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}

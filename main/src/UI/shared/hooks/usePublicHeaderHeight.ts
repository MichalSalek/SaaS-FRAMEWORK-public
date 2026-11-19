import { useEffect, type RefObject } from 'react';

export function usePublicHeaderHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const header = ref.current;
    if (!header) {
      return;
    }
    const update = () =>
      document.documentElement.style.setProperty(
        '--public-header-height',
        `${header.getBoundingClientRect().height}px`
      );
    // No synchronous first measurement: a ResizeObserver reports the initial
    // size itself, after layout and before paint, while a read here forced a
    // layout during the hydration commit.
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--public-header-height');
    };
  }, [ref]);
}

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
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--public-header-height');
    };
  }, [ref]);
}

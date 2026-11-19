import { useEffect } from 'react';
import { trackInternalLinkClick } from '../../application/analytics/cta-events';

/**
 * Clicks on internal links in page content. Page views do not say which
 * control continued the path (a paragraph link, a „zobacz też" tile, or a
 * menu item). One document listener, because those links live in MDX.
 * Header, footer, menu, bottom bar and controls with their own CTA measure
 * are skipped, so chrome clicks and double counts stay out.
 */
export function useInternalLinkTracking(): void {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Left button, and keyboard activation (Enter emits `click`).
      // The middle button arrives as `auxclick`, so it never reaches this
      // handler. On content links that gap is not worth a separate listener.
      if (event.button !== 0) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }

      if (
        anchor.closest(
          '[data-cta-tracked], [data-sticky-cta], header, footer, nav'
        )
      ) {
        return;
      }

      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) {
        return;
      }

      trackInternalLinkClick(href);
    }

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

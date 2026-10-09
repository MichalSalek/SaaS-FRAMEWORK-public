import { useCallback, useState } from 'react';
import posthog from 'posthog-js';
import type { GalleryLayout } from '../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';

/** Ekran, na którym stoi przełącznik — wymiar podziału w analityce. */
export type GalleryLayoutSurface =
  'own-gallery' | 'stylist-gallery' | 'explore';

/**
 * Stan przełącznika widoku galerii plus jedno zdarzenie analityczne.
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-09-17:
 * (1) Domyślny jest FEED, nie siatka („widok siatki niech zostanie, ale nie
 *     może być domyślny”) — galeria to portfolio, nie menedżer plików.
 * (2) Musimy wiedzieć po premierze, czy ktokolwiek w ogóle przełącza na
 *     siatkę. Autocapture PostHoga łapie ten klik już dziś, ale filtruje się
 *     go po `aria-label`, który jest tłumaczony na trzy języki — dlatego
 *     jawne zdarzenie `gallery_layout_toggled` z docelowym widokiem i
 *     ekranem. Zdarzenie siedzi TUTAJ, a nie w atomie przełącznika: atom nie
 *     zna ekranu i renderuje się też w bibliotece komponentów, która
 *     zaśmiecałaby statystykę.
 * Rejestr zdarzeń: docs/DOMAIN/product/ANALYTICS_TRACKING_PLAN.md §3.
 */
export function useGalleryLayout(surface: GalleryLayoutSurface): {
  layout: GalleryLayout;
  isFullWidth: boolean;
  toggleLayout: () => void;
} {
  const [layout, setLayout] = useState<GalleryLayout>('full-width');

  const toggleLayout = useCallback(() => {
    const next: GalleryLayout = layout === 'tiles' ? 'full-width' : 'tiles';
    setLayout(next);
    posthog.capture('gallery_layout_toggled', { to: next, surface });
  }, [layout, surface]);

  return { layout, isFullWidth: layout === 'full-width', toggleLayout };
}

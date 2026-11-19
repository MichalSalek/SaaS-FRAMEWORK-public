import { useCallback, useState } from 'react';
import { capturePosthog } from '../../../application/analytics/posthog-client';
import type { GalleryLayout } from '../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import {
  readGalleryLayout,
  rememberGalleryLayout,
} from '../../layouts/history-scroll';

/** Ekran, na którym stoi przełącznik — wymiar podziału w analityce. */
export type GalleryLayoutSurface =
  'own-gallery' | 'stylist-gallery' | 'explore';

export function useGalleryLayout(surface: GalleryLayoutSurface): {
  layout: GalleryLayout;
  isFullWidth: boolean;
  toggleLayout: () => void;
} {
  const [layout, setLayout] = useState<GalleryLayout>(
    () => readGalleryLayout(surface) ?? 'full-width'
  );

  const toggleLayout = useCallback(() => {
    const next: GalleryLayout = layout === 'tiles' ? 'full-width' : 'tiles';
    setLayout(next);
    rememberGalleryLayout(surface, next);
    capturePosthog('gallery_layout_toggled', { to: next, surface });
  }, [layout, surface]);

  return { layout, isFullWidth: layout === 'full-width', toggleLayout };
}

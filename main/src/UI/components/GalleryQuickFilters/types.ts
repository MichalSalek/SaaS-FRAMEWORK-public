// UI/components/GalleryQuickFilters/types.ts
// Shared type for nail-length filter options.
//
// Lives here, co-located with its consumers (GalleryQuickFilters + GalleryFilterOverlay), because
// components must never import from features; the feature config re-imports it.

import type { NailLength } from '@kernel/domain/gallery/nail-length.config';

export interface NailLengthOption {
  readonly id: NailLength;
  readonly label: string;
}

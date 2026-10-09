// UI/components/GalleryQuickFilters/types.ts
// Shared type for nail-length filter options.
//
// DECISION (nie usuwaj tego komentarza):
// This type was previously exported from `UI/features/gallery/nailLengthOptions.config.ts`,
// which created a reverse import (UI/components/ → UI/features/) — components should
// never import from features. The type now lives co-located with its primary consumers
// (GalleryQuickFilters + GalleryFilterOverlay) and the feature config re-imports it.

import type { NailLength } from '@kernel/domain/gallery/nail-length.config';

export interface NailLengthOption {
  readonly id: NailLength;
  readonly label: string;
}

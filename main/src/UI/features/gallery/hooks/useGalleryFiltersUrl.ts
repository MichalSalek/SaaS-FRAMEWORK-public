// UI/features/gallery/hooks/useGalleryFiltersUrl.ts
// Keeps the gallery filters in the address, so opening a photo and coming back
// returns to the same filtered list (and a reload or a shared link keeps it).
//
// DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
// The filter state itself lives in the shared `useGalleryFiltersState`
// (useState, no initial value, no controlled mode), which three galleries
// use. Until that hook accepts an initial state, this one MIRRORS it: the
// address is read once and replayed through the hook's own toggles, then every
// change is written back. `ready` is false until that replay happened; the
// page keeps its skeleton meanwhile, otherwise a return from a photo would
// paint the unfiltered grid for a frame and then swap it.

import { useEffect, useRef, useState } from 'react';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { useUrlSyncedState } from '../../../shared/hooks/useUrlSyncedState';
import type { GalleryFiltersState } from '../../shared/gallery/hooks/useGalleryFiltersState';
import { GALLERY_FILTERS_URL_CODEC } from './galleryFiltersUrl.helpers';

interface GalleryFiltersControls {
  filters: GalleryFiltersState;
  toggleColor: (id: string) => void;
  toggleTrait: (id: string) => void;
  toggleLength: (id: NailLength) => void;
  setExactMatch: (value: boolean) => void;
}

/**
 * @param enabled false while the page does not know yet WHICH filter state it
 *   shows (a stylist's gallery picks the public or the paired one only after
 *   the pairing check); the address is replayed once it is true.
 */
export function useGalleryFiltersUrl(
  controls: GalleryFiltersControls,
  enabled = true
): boolean {
  const [urlFilters, setUrlFilters, urlReady] = useUrlSyncedState(
    GALLERY_FILTERS_URL_CODEC
  );
  const [ready, setReady] = useState(false);
  // The toggles are recreated on every render; the effects below must not
  // re-run because of that.
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  // Address → filters, once.
  useEffect(() => {
    if (!urlReady || !enabled || ready) {
      return;
    }
    const { filters, toggleColor, toggleTrait, toggleLength, setExactMatch } =
      controlsRef.current;
    for (const id of urlFilters.selectedColors) {
      if (!filters.selectedColors.includes(id)) {
        toggleColor(id);
      }
    }
    for (const id of urlFilters.selectedTraits) {
      if (!filters.selectedTraits.includes(id)) {
        toggleTrait(id);
      }
    }
    if (
      urlFilters.selectedLength !== null &&
      urlFilters.selectedLength !== filters.selectedLength
    ) {
      toggleLength(urlFilters.selectedLength);
    }
    if (urlFilters.exactMatch !== filters.exactMatch) {
      setExactMatch(urlFilters.exactMatch);
    }
    setReady(true);
  }, [urlReady, enabled, ready, urlFilters]);

  // Filters → address, from the replay on.
  const { filters } = controls;
  useEffect(() => {
    if (ready) {
      setUrlFilters(filters);
    }
  }, [ready, filters, setUrlFilters]);

  return ready;
}

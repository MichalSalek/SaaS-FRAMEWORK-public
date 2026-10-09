// UI/features/explore/hooks/useGalleryFilters.ts
// Component-level filter state for Explore page.
// Filters in useState (NOT URL params — decision A21).

import { useState } from 'react';
import posthog from 'posthog-js';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';

/* ─── Types ─── */

export interface ExploreFilters {
  nail_length: NailLength | undefined;
  color_ids: string[];
  trait_ids: string[];
  city: string | undefined;
  searchQuery: string | undefined;
  apply_strict_filter: boolean;
}

const INITIAL_FILTERS: ExploreFilters = {
  nail_length: undefined,
  color_ids: [],
  trait_ids: [],
  city: undefined,
  searchQuery: undefined,
  apply_strict_filter: false,
};

/* ─── Analytics ─── */

// Semantyczny event feature-discovery (ANALYTICS_TRACKING_PLAN §3:
// EXPLORE_FILTER_APPLIED). Capture TYLKO przy aktywacji filtra (dodanie /
// wybór), nie przy zdjęciu — mierzy użycie, nie sprzątanie. Wołane POZA
// setState-updaterem (side-effect w updaterze = StrictMode double-fire).
// Wartości = wewnętrzne id/enum (color/trait/nail_length), zero PII.
// posthog singleton = instancja PostHogProvider, respektuje opt-out;
// hook żyje za flagą EXPLORE_ENABLED — eventy popłyną po jej włączeniu.
const captureFilterApplied = (
  filterType: 'color' | 'trait' | 'nail_length' | 'strict_match',
  value: string
): void => {
  posthog.capture('explore_filter_applied', {
    filter_type: filterType,
    value,
  });
};

/* ─── Hook ─── */

export function useGalleryFilters() {
  // DECISION (nie usuwaj): filtry w useState, NIE URL params (A21) — pre-launch
  // prostota; refresh resetuje filtry, brak deep-link share. Świadoma decyzja.
  const [filters, setFilters] = useState<ExploreFilters>(INITIAL_FILTERS);

  const setNailLength = (length: NailLength | undefined) => {
    if (length !== undefined && filters.nail_length !== length) {
      captureFilterApplied('nail_length', length);
    }
    setFilters(prev => ({ ...prev, nail_length: length }));
  };

  const toggleColor = (colorName: string) => {
    if (!filters.color_ids.includes(colorName)) {
      captureFilterApplied('color', colorName);
    }
    setFilters(prev => {
      const exists = prev.color_ids.includes(colorName);
      return {
        ...prev,
        color_ids: exists
          ? prev.color_ids.filter(c => c !== colorName)
          : [...prev.color_ids, colorName],
      };
    });
  };

  const toggleTrait = (traitName: string) => {
    if (!filters.trait_ids.includes(traitName)) {
      captureFilterApplied('trait', traitName);
    }
    setFilters(prev => {
      const exists = prev.trait_ids.includes(traitName);
      return {
        ...prev,
        trait_ids: exists
          ? prev.trait_ids.filter(t => t !== traitName)
          : [...prev.trait_ids, traitName],
      };
    });
  };

  const toggleNailLength = (id: NailLength) => {
    if (filters.nail_length !== id) {
      captureFilterApplied('nail_length', id);
    }
    setFilters(prev => ({
      ...prev,
      nail_length: prev.nail_length === id ? undefined : id,
    }));
  };

  const setCity = (city: string | undefined) => {
    setFilters(prev => ({ ...prev, city }));
  };

  const setSearchQuery = (searchQuery: string | undefined) => {
    setFilters(prev => ({ ...prev, searchQuery }));
  };

  const setExactMatch = (apply_strict_filter: boolean) => {
    if (apply_strict_filter && !filters.apply_strict_filter) {
      captureFilterApplied('strict_match', 'true');
    }
    setFilters(prev => ({ ...prev, apply_strict_filter }));
  };

  const clearAll = () => {
    setFilters(INITIAL_FILTERS);
  };

  const totalActiveFilters = (() => {
    let count = 0;
    if (filters.nail_length) {
      count += 1;
    }
    count += filters.color_ids.length;
    count += filters.trait_ids.length;
    return count;
  })();

  return {
    filters,
    setNailLength,
    toggleColor,
    toggleTrait,
    toggleNailLength,
    setCity,
    setSearchQuery,
    setExactMatch,
    clearAll,
    totalActiveFilters,
  };
}

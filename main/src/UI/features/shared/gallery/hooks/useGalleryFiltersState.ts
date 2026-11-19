import { useLocale } from 'next-intl';
import { getLocalizedTaxonomyName } from '../../../../../domain/gallery/gallery-taxonomy.locale';
import { useState, useMemo } from 'react';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import {
  NAIL_LENGTH_OPTIONS,
  type NailLengthOption,
} from '../nailLengthOptions.config';

type ColorDTO = GALLERY_DTO_API_V1['GET_COLORS']['RESPONSE'][number];
type TraitDTO = GALLERY_DTO_API_V1['GET_TRAITS']['RESPONSE'][number];

export interface GalleryFiltersState {
  // selectedColors/selectedTraits hold color/trait IDs (cuid), not names —
  // matches the shared GalleryQuickFilters contract and the Explore server-side
  // filter (color_id/trait_id). Filtering below compares record relation ids.
  selectedColors: string[];
  selectedTraits: string[];
  selectedLength: NailLength | null;
  exactMatch: boolean;
}

type FilterableRecord = {
  colors: ColorDTO[];
  traits: TraitDTO[];
  nail_length: string;
};

const EMPTY_FILTERS: GalleryFiltersState = {
  selectedColors: [],
  selectedTraits: [],
  selectedLength: null,
  exactMatch: false,
};

/**
 * Shared gallery filter state + filtering logic used by:
 *  - useOwnGalleryFilters (stylist's own gallery)
 *  - useStylistGallery (public stylist profile)
 *  - usePairedStylistGallery (paired client view)
 *
 * Filters by colors/traits (any-of or all-of via exactMatch), and nail_length.
 * `availableColors/Traits/NailLengths` derive from the actual records, so the
 * UI shows only options present in the data.
 */
export function useGalleryFiltersState<T extends FilterableRecord>(
  records: T[]
) {
  const locale = useLocale();
  const [filters, setFilters] = useState<GalleryFiltersState>(EMPTY_FILTERS);

  const availableColors = useMemo(() => {
    const seen = new Map<string, ColorDTO>();
    records.forEach(r => r.colors.forEach(c => seen.set(c.id, c)));
    return Array.from(seen.values(), item => ({
      ...item,
      name: getLocalizedTaxonomyName(item.name, locale),
    }));
  }, [records, locale]);

  const availableTraits = useMemo(() => {
    const seen = new Map<string, TraitDTO>();
    records.forEach(r => r.traits.forEach(t => seen.set(t.id, t)));
    return Array.from(seen.values(), item => ({
      ...item,
      name: getLocalizedTaxonomyName(item.name, locale),
    }));
  }, [records, locale]);

  const availableNailLengths = useMemo((): readonly NailLengthOption[] => {
    const lengths = new Set<string>(records.map(r => r.nail_length));
    return NAIL_LENGTH_OPTIONS.filter(o => lengths.has(o.id));
  }, [records]);

  const filteredRecords = useMemo(() => {
    const { selectedColors, selectedTraits, selectedLength, exactMatch } =
      filters;
    const hasColorFilter = selectedColors.length > 0;
    const hasTraitFilter = selectedTraits.length > 0;
    const hasLengthFilter = selectedLength !== null;

    if (!hasColorFilter && !hasTraitFilter && !hasLengthFilter) {
      return records;
    }

    return records.filter(record => {
      const recordColorIds = record.colors.map(c => c.id);
      const recordTraitIds = record.traits.map(t => t.id);

      const colorMatch =
        !hasColorFilter ||
        (exactMatch
          ? selectedColors.every(c => recordColorIds.includes(c))
          : selectedColors.some(c => recordColorIds.includes(c)));
      const traitMatch =
        !hasTraitFilter ||
        (exactMatch
          ? selectedTraits.every(t => recordTraitIds.includes(t))
          : selectedTraits.some(t => recordTraitIds.includes(t)));
      const lengthMatch =
        !hasLengthFilter || record.nail_length === selectedLength;

      return colorMatch && traitMatch && lengthMatch;
    });
  }, [records, filters]);

  const toggleColor = (id: string) => {
    setFilters(prev => ({
      ...prev,
      selectedColors: prev.selectedColors.includes(id)
        ? prev.selectedColors.filter(c => c !== id)
        : [...prev.selectedColors, id],
    }));
  };

  const toggleTrait = (id: string) => {
    setFilters(prev => ({
      ...prev,
      selectedTraits: prev.selectedTraits.includes(id)
        ? prev.selectedTraits.filter(t => t !== id)
        : [...prev.selectedTraits, id],
    }));
  };

  const toggleLength = (id: NailLength) => {
    setFilters(prev => ({
      ...prev,
      selectedLength: prev.selectedLength === id ? null : id,
    }));
  };

  const setExactMatch = (value: boolean) => {
    setFilters(prev => ({ ...prev, exactMatch: value }));
  };

  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
  };

  const totalActiveFilters =
    filters.selectedColors.length +
    filters.selectedTraits.length +
    (filters.selectedLength !== null ? 1 : 0);

  return {
    filters,
    filteredRecords,
    availableColors,
    availableTraits,
    availableNailLengths,
    totalActiveFilters,
    toggleColor,
    toggleTrait,
    toggleLength,
    setExactMatch,
    clearAll,
  };
}

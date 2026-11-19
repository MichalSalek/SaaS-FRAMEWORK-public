// UI/features/shared/gallery/hooks/useGalleryFilterOptions.ts
// The full color + trait taxonomy for a gallery filter sheet, plus whether it
// failed to load. Both reads are background queries (a failed GET from a
// queryFn raises no global toast, error-feedback.policy), so a failure with
// nothing cached must be said by the sheet itself; otherwise its color and
// trait sections render empty, which reads as „nothing to filter by".

import { useGalleryColors } from './useGalleryColors';
import { useGalleryTraits } from './useGalleryTraits';

export function useGalleryFilterOptions() {
  const colorsQuery = useGalleryColors();
  const traitsQuery = useGalleryTraits();
  const { colors } = colorsQuery;
  const { traits } = traitsQuery;
  // Cached options win over a failed refresh (TQ v5 keeps the last read).
  const colorsFailed = colorsQuery.isError && colors.length === 0;
  const traitsFailed = traitsQuery.isError && traits.length === 0;

  const retryOptions = () => {
    if (colorsFailed) {
      void colorsQuery.refetch();
    }
    if (traitsFailed) {
      void traitsQuery.refetch();
    }
  };

  return {
    colors,
    traits,
    optionsLoadFailed: colorsFailed || traitsFailed,
    retryOptions,
    isRetryingOptions: colorsQuery.isFetching || traitsQuery.isFetching,
  };
}

import { useTranslations } from 'next-intl';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { NailLengthOption } from '../../../components/GalleryQuickFilters/types';

// Re-export so existing call sites that import the type from this config keep working.
// DECISION (nie usuwaj tego komentarza):
// The canonical location is `UI/components/GalleryQuickFilters/types.ts` to avoid
// the reverse import (components → features) flagged in turbo-review r17 (H25).
export type { NailLengthOption };

export const NAIL_LENGTH_OPTIONS: readonly NailLengthOption[] = [
  { id: NAIL_LENGTHS.SHORT, label: 'short' },
  { id: NAIL_LENGTHS.MEDIUM, label: 'medium' },
  { id: NAIL_LENGTHS.LONG, label: 'long' },
  { id: NAIL_LENGTHS.XL, label: 'XL' },
] as const;

/**
 * Hook that returns nail length options with translated labels.
 * Use this in components that render nail length labels to the user.
 */
export function useNailLengthOptions(): readonly NailLengthOption[] {
  const t = useTranslations('galleryFilter');
  return [
    { id: NAIL_LENGTHS.SHORT, label: t('nailLengthShort') },
    { id: NAIL_LENGTHS.MEDIUM, label: t('nailLengthMedium') },
    { id: NAIL_LENGTHS.LONG, label: t('nailLengthLong') },
    { id: NAIL_LENGTHS.XL, label: t('nailLengthXL') },
  ];
}

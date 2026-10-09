import { useState } from 'react';
import clsx from 'clsx';
import { useTranslations } from 'next-intl';
import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import type { GalleryFilterOverlayProps } from '../GalleryFilterOverlay/GalleryFilterOverlay.organism';
import { GalleryFilterOverlayOrganism } from '../GalleryFilterOverlay/GalleryFilterOverlay.organism';
import styles from './GalleryFilterSection.module.css';

/* ─── Types ─── */

export interface GalleryFilterSectionProps extends Omit<
  GalleryFilterOverlayProps,
  'isOpen' | 'onClose'
> {
  /** CSS class for the FAB button (to allow page-specific positioning) */
  fabClassName?: string;
  /** CSS class for the FAB badge */
  fabBadgeClassName?: string;
}

/* ─── Component ─── */

export function GalleryFilterSectionOrganism({
  fabClassName,
  fabBadgeClassName,
  totalActiveFilters,
  ...overlayProps
}: GalleryFilterSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations('galleryUI');

  return (
    <>
      {/* Filter FAB */}
      <button
        type='button'
        className={clsx(styles.filterFab, fabClassName)}
        onClick={() => setIsOpen(true)}
        aria-label={t('openFilters')}>
        <SlidersHorizontalIcon size={22} />
        {totalActiveFilters > 0 && (
          <span className={clsx(styles.filterFabBadge, fabBadgeClassName)}>
            {totalActiveFilters}
          </span>
        )}
      </button>

      {/* Fullscreen Filter Overlay */}
      <GalleryFilterOverlayOrganism
        isOpen={isOpen}
        totalActiveFilters={totalActiveFilters}
        onClose={() => setIsOpen(false)}
        {...overlayProps}
      />
    </>
  );
}

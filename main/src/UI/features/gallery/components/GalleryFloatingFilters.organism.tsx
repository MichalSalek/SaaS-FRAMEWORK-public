// UI/features/gallery/components/GalleryFloatingFilters.organism.tsx
// The floating filter button of a gallery list, shown only while the in-content
// filter row (GalleryFilterBar) is scrolled out of view.
//
// DECISION (nie usuwaj tego komentarza) — S126, 2026-10-08:
// S115 keeps a floating button so filters stay reachable deep in the list
// (the filter row is not sticky). The owner's remark of 2026-10-08 was that at
// the top of the page this button floated over the first photo, right next to
// the QR button of the tab bar: two round floating controls and two filter
// entries on one screen. Both hold now: the button exists only while the row
// is gone from the screen. It must stay OUTSIDE any element with
// `container-type` (that makes the element the containing block of
// `position: fixed`, and the button would scroll away with the list).

import clsx from 'clsx';
import {
  GalleryFilterSectionOrganism,
  type GalleryFilterSectionProps,
} from '../../../components/GalleryFilterSection/GalleryFilterSection.organism';
import styles from './GalleryFilterBar.module.css';

interface GalleryFloatingFiltersProps extends Omit<
  GalleryFilterSectionProps,
  'fabClassName' | 'fabBadgeClassName'
> {
  /** True while the in-content filter row is NOT on screen. */
  visible: boolean;
}

export function GalleryFloatingFiltersOrganism({
  visible,
  ...sectionProps
}: GalleryFloatingFiltersProps) {
  return (
    <GalleryFilterSectionOrganism
      {...sectionProps}
      fabClassName={clsx(
        styles.floatingEntry,
        !visible && styles.floatingEntryHidden
      )}
    />
  );
}

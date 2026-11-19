// UI/features/gallery/components/GalleryFloatingFilters.organism.tsx
// The floating filter button of a gallery list, shown only while the in-content
// filter row (GalleryFilterBar) is scrolled out of view.
//
// DECISION: a floating button keeps filters reachable deep in the list (the filter row is not
// sticky). At the top of the page it floated over the first photo, next to the QR button of the tab
// bar: two round floating controls and two filter entries on one screen (owner). So the
// button exists only while the row is gone from the screen. It must stay OUTSIDE any element with
// `container-type` (that makes the element the containing block of `position: fixed`, and the
// button would scroll away with the list).

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
  /** A sticky action bar stands on the tab bar (session pick mode): the
   *  button floats above it instead of over its action. */
  aboveBar?: boolean;
}

export function GalleryFloatingFiltersOrganism({
  visible,
  aboveBar = false,
  ...sectionProps
}: GalleryFloatingFiltersProps) {
  return (
    <GalleryFilterSectionOrganism
      {...sectionProps}
      fabClassName={clsx(
        styles.floatingEntry,
        aboveBar && styles.floatingEntryAboveBar,
        !visible && styles.floatingEntryHidden
      )}
    />
  );
}

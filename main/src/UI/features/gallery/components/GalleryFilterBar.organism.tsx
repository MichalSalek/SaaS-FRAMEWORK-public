// UI/features/gallery/components/GalleryFilterBar.organism.tsx
// The ONE filter control of a gallery list: „Filtry N” + the active filters as
// removable chips + the layout toggle. The full groups (colors, traits,
// lengths, match mode) open on demand in the shared filter overlay.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08 (S126):
// the three always-open chip groups took ~330px above the first photo
// („rozlazłe, nie prowadzi do głównej akcji”); the photos are the content, so
// the list shows one compact row that says WHAT is active and nothing else.
// The S115 decision still holds: this row is NOT sticky and scrolls away, and
// the floating button of GalleryFilterSection keeps filters reachable. The
// page shows that button only while this row is out of view (`onInViewChange`),
// so there are never two filter entries on screen at once.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  ChipAtom,
  ChipGroupMolecule,
} from '../../../components/Chip/Chip.atom';
import {
  GalleryLayoutToggleAtom,
  type GalleryLayout,
} from '../../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import {
  GalleryFilterOverlayOrganism,
  type GalleryFilterOverlayProps,
} from '../../../components/GalleryFilterOverlay/GalleryFilterOverlay.organism';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import styles from './GalleryFilterBar.module.css';

export interface GalleryFilterBarProps extends Omit<
  GalleryFilterOverlayProps,
  'isOpen' | 'onClose' | 'selectedLength'
> {
  selectedLength: NailLength | null;
  layout: GalleryLayout;
  onToggleLayout: () => void;
  /** False once the row has scrolled out of view (the page then shows the
   *  floating filter button). */
  onInViewChange: (inView: boolean) => void;
  /** Quiet result line next to the entry, e.g. „3 z 9”; only while filtering. */
  resultSummary?: string;
}

interface ActiveFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

export function GalleryFilterBarOrganism({
  layout,
  onToggleLayout,
  onInViewChange,
  resultSummary,
  ...overlayProps
}: GalleryFilterBarProps) {
  const t = useTranslations('galleryFilter');
  const tA11y = useTranslations('a11y');
  const [isOpen, setIsOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const onInViewChangeRef = useRef(onInViewChange);
  onInViewChangeRef.current = onInViewChange;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof IntersectionObserver === 'undefined') {
      return;
    }
    const observer = new IntersectionObserver(entries => {
      const entry = entries.at(-1);
      if (entry !== undefined) {
        onInViewChangeRef.current(entry.isIntersecting);
      }
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const {
    allColors,
    allTraits,
    allNailLengths,
    availableColors,
    availableTraits,
    selectedColors,
    selectedTraits,
    selectedLength,
    totalActiveFilters,
    onToggleColor,
    onToggleTrait,
    onToggleLength,
  } = overlayProps;

  // Names come from the full option list; the options present in the loaded
  // photos win, so a filter whose option list failed to load still has a name.
  const colorNames = new Map(
    [...allColors, ...availableColors].map(c => [c.id, c.name])
  );
  const traitNames = new Map(
    [...allTraits, ...availableTraits].map(tr => [tr.id, tr.name])
  );
  const activeFilters: ActiveFilter[] = [];
  for (const id of selectedColors) {
    const label = colorNames.get(id);
    if (label !== undefined) {
      activeFilters.push({
        key: `color-${id}`,
        label,
        onRemove: () => onToggleColor(id),
      });
    }
  }
  for (const id of selectedTraits) {
    const label = traitNames.get(id);
    if (label !== undefined) {
      activeFilters.push({
        key: `trait-${id}`,
        label,
        onRemove: () => onToggleTrait(id),
      });
    }
  }
  if (selectedLength !== null) {
    const label = allNailLengths.find(o => o.id === selectedLength)?.label;
    if (label !== undefined) {
      activeFilters.push({
        key: `length-${selectedLength}`,
        label,
        onRemove: () => onToggleLength(selectedLength),
      });
    }
  }

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        <div className={styles.bar} role='group' aria-label={t('ariaLabel')}>
          <ButtonAtom
            variant='outlined'
            size='md'
            className={styles.entry}
            icon={<SlidersHorizontalIcon size={18} />}
            aria-haspopup='dialog'
            onClick={() => setIsOpen(true)}>
            {t('title')}
            {totalActiveFilters > 0 && (
              <span className={styles.entryCount}>{totalActiveFilters}</span>
            )}
          </ButtonAtom>

          {resultSummary !== undefined && (
            <span className={styles.summary} aria-live='polite'>
              {resultSummary}
            </span>
          )}

          <GalleryLayoutToggleAtom
            layout={layout}
            onToggle={onToggleLayout}
            className={styles.layoutToggle}
          />

          {activeFilters.length > 0 && (
            <ChipGroupMolecule className={styles.active}>
              {activeFilters.map(filter => (
                <ChipAtom
                  key={filter.key}
                  label={filter.label}
                  size='md'
                  selected
                  onClick={filter.onRemove}
                  aria-label={tA11y('remove', { label: filter.label })}
                />
              ))}
            </ChipGroupMolecule>
          )}
        </div>
      </div>

      <GalleryFilterOverlayOrganism
        {...overlayProps}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

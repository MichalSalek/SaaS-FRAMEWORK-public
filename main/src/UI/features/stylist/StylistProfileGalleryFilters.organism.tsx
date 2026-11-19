import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontalIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { GalleryFilterOverlayOrganism } from '../../components/GalleryFilterOverlay/GalleryFilterOverlay.organism';
import type { useStylistGallery } from '../shared/gallery/hooks/useStylistGallery';
import { useNailLengthOptions } from '../shared/gallery/nailLengthOptions.config';
import styles from './StylistProfileGalleryFilters.module.css';

interface StylistProfileGalleryFiltersProps {
  gallery: ReturnType<typeof useStylistGallery>;
  children: ReactNode;
}

/** All options and counts derive from the public pinned response, never the full gallery. */
export function StylistProfileGalleryFiltersOrganism({
  gallery,
  children,
}: StylistProfileGalleryFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const clearAllRef = useRef(gallery.clearAll);
  clearAllRef.current = gallery.clearAll;
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }
    const desktop = window.matchMedia('(min-width: 1024px)');
    const resetOnDesktop = (matches: boolean) => {
      if (matches) {
        setIsOpen(false);
        clearAllRef.current();
      }
    };
    const onChange = (event: MediaQueryListEvent) =>
      resetOnDesktop(event.matches);
    resetOnDesktop(desktop.matches);
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);
  const t = useTranslations('galleryFilter');
  const tGallery = useTranslations('pages.gallery');
  const lengths = useNailLengthOptions().filter(option =>
    gallery.availableNailLengths.some(available => available.id === option.id)
  );

  return (
    <>
      <div className={styles.headingRow}>
        {children}
        <ButtonAtom
          className={styles.filterButton}
          variant='outlined'
          size='md'
          icon={<SlidersHorizontalIcon size={18} />}
          aria-haspopup='dialog'
          onClick={() => setIsOpen(true)}>
          {t('title')}
          {gallery.totalActiveFilters > 0 && (
            <span className={styles.count}>{gallery.totalActiveFilters}</span>
          )}
        </ButtonAtom>
      </div>
      {gallery.totalActiveFilters > 0 && (
        <div className={styles.bar}>
          <span className={styles.summary} role='status'>
            {tGallery('filterResultSummary', {
              shown: gallery.filteredRecords.length,
              total: gallery.allRecords.length,
            })}
          </span>
          <ButtonAtom variant='ghost' size='md' onClick={gallery.clearAll}>
            {t('clearFilters')}
          </ButtonAtom>
        </div>
      )}
      <GalleryFilterOverlayOrganism
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        allColors={gallery.availableColors}
        allTraits={gallery.availableTraits}
        allNailLengths={lengths}
        availableColors={gallery.availableColors}
        availableTraits={gallery.availableTraits}
        availableNailLengths={lengths}
        selectedColors={gallery.filters.selectedColors}
        selectedTraits={gallery.filters.selectedTraits}
        selectedLength={gallery.filters.selectedLength}
        exactMatch={gallery.filters.exactMatch}
        matchingCount={gallery.filteredRecords.length}
        totalActiveFilters={gallery.totalActiveFilters}
        onToggleColor={gallery.toggleColor}
        onToggleTrait={gallery.toggleTrait}
        onToggleLength={gallery.toggleLength}
        onExactMatchChange={gallery.setExactMatch}
        onClearAll={gallery.clearAll}
      />
    </>
  );
}

// UI/features/gallery/components/StylistPortfolioSection.tsx
// Portfolio section for StylistGalleryPage: one filter control row + the grid.

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { GalleryLayout } from '../../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import { StylistNoFilterResultsOrganism } from '../StylistGalleryPage.parts.organism';
import { StylistCardItemOrganism } from '../StylistGalleryCardItem.organism';
import type { StylistGalleryRecord } from '../../shared/gallery/hooks/useStylistGallery';
import type { PairedGalleryRecord } from '../hooks/usePairedStylistGallery';
import styles from '../StylistGalleryPage.module.css';

interface StylistPortfolioSectionProps {
  /** The filter control row (GalleryFilterBar), built by the page. */
  filterBar: ReactNode;
  displayedRecords: (StylistGalleryRecord | PairedGalleryRecord)[];
  clearAll: () => void;
  layout: GalleryLayout;
  usePaired: boolean;
  showWatermark: boolean;
  favoritedIds: Set<string>;
  /** False = heart state not known yet (favorites still loading or failed). */
  isFavoriteResolved: (recordId: string) => boolean;
  canFavorite: boolean;
  onFavoriteToggle: (recordId: string) => void;
  isSessionPickMode: boolean;
  onPickPhotoForSession?: (galleryRecordId: string) => void;
}

export function StylistPortfolioSectionOrganism({
  filterBar,
  displayedRecords,
  clearAll,
  layout,
  usePaired,
  showWatermark,
  favoritedIds,
  isFavoriteResolved,
  canFavorite,
  onFavoriteToggle,
  isSessionPickMode,
  onPickPhotoForSession,
}: StylistPortfolioSectionProps) {
  const t = useTranslations('pages.gallery');
  const isFullWidth = layout === 'full-width';

  return (
    <section className={styles.portfolioSection}>
      {/* The stylist card above already says how many works there are; the
          heading stays for the document outline only. */}
      <h2 className='sr-only'>{t('galleryTitle')}</h2>

      {filterBar}

      {displayedRecords.length === 0 ? (
        <StylistNoFilterResultsOrganism onClear={clearAll} />
      ) : (
        <div
          className={
            isFullWidth ? styles.galleryListFullWidth : styles.galleryList
          }>
          {displayedRecords.map(record => (
            <StylistCardItemOrganism
              key={record.gallery_record_id}
              record={record}
              usePaired={usePaired}
              showWatermark={showWatermark}
              isFavorited={favoritedIds.has(record.gallery_record_id)}
              isFavoriteResolved={isFavoriteResolved(record.gallery_record_id)}
              isFullWidth={isFullWidth}
              canFavorite={canFavorite}
              onFavoriteToggle={onFavoriteToggle}
              {...(isSessionPickMode && onPickPhotoForSession
                ? { onCardClick: onPickPhotoForSession }
                : {})}
            />
          ))}
        </div>
      )}
    </section>
  );
}

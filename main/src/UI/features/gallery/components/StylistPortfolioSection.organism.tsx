// UI/features/gallery/components/StylistPortfolioSection.tsx
// Portfolio section for StylistGalleryPage: one filter control row + the grid.

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { useViewTransitionRouter } from '../../../layouts/useViewTransitionRouter';
import type { GalleryLayout } from '../../../components/GalleryLayoutToggle/GalleryLayoutToggle.atom';
import { StylistNoFilterResultsOrganism } from '../StylistGalleryPage.parts.organism';
import { StylistCardItemOrganism } from '../StylistGalleryCardItem.organism';
import type { StylistGalleryRecord } from '../../shared/gallery/hooks/useStylistGallery';
import type { PairedGalleryRecord } from '../hooks/usePairedStylistGallery';
import type { SessionPhotoPicker } from '../../shared/sessions/hooks/useSessionPhotoPicker';
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
  /** Set while the client chooses photos for a session: a tap on a card then
   *  puts the photo in or takes it back instead of opening it. */
  sessionPicker?: SessionPhotoPicker;
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
  sessionPicker,
}: StylistPortfolioSectionProps) {
  // Outside session pick mode, for a connected viewer, a tap on a card opens
  // the photo (where a client can add it to her session). Until 2026-10-11 a
  // card in this gallery opened nothing; only the heart worked.
  const navigate = useViewTransitionRouter();
  const openPhoto = (id: string) =>
    navigate(buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id }));
  const t = useTranslations('pages.gallery');
  const pickLabels = {
    add: t('sessionPick.addPhoto'),
    remove: t('sessionPick.removePhoto'),
  };
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
              {...(sessionPicker !== undefined
                ? {
                    onCardClick: sessionPicker.toggle,
                    pick: {
                      selected: sessionPicker.isPicked(
                        record.gallery_record_id
                      ),
                      pending:
                        !sessionPicker.isReady ||
                        sessionPicker.isPending(record.gallery_record_id),
                      addLabel: pickLabels.add,
                      removeLabel: pickLabels.remove,
                    },
                  }
                : usePaired
                  ? { onCardClick: openPhoto }
                  : {})}
            />
          ))}
        </div>
      )}
    </section>
  );
}

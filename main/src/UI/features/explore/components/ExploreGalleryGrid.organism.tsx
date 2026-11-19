// UI/features/explore/components/ExploreGalleryGrid.tsx
// Gallery grid with infinite scroll sentinel, loading indicator, and card rendering.

import { memo } from 'react';
import clsx from 'clsx';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { GalleryPhotoCardOrganism } from '../../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { InfiniteScrollTriggerComposition } from '../../../components/InfiniteScrollTrigger.composition';
import styles from '../ExplorePage.module.css';

/* ─── Types ─── */

type ExploreRecord =
  GALLERY_DTO_API_V1['EXPLORE_GALLERY_RECORDS']['RESPONSE']['records'][number];

interface ExploreGalleryGridProps {
  records: ExploreRecord[];
  isFullWidth: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  favoritedIds: Set<string>;
  onFetchNextPage: (() => void) | (() => Promise<unknown>);
  onFavoriteToggle: (recordId: string) => void;
  onCardClick: (recordId: string) => void;
}

/* ─── Card item (stable props for React.memo) ─── */

interface ExploreCardItemProps {
  record: ExploreRecord;
  isFullWidth: boolean;
  isFavorited: boolean;
  onFavoriteToggle: (recordId: string) => void;
  onCardClick: (recordId: string) => void;
}

const ExploreCardItem = memo(function ExploreCardItem({
  record,
  isFullWidth,
  isFavorited,
  onFavoriteToggle,
  onCardClick,
}: ExploreCardItemProps) {
  const handleFavoriteToggle = () => onFavoriteToggle(record.gallery_record_id);
  const handleCardClick = () => onCardClick(record.gallery_record_id);
  const footer =
    record.created_by_account != null ? (
      <div className={styles.stylistAttribution}>
        <span className={styles.stylistName}>
          {record.created_by_account.display_name}
        </span>
        {record.created_by_account.address_city != null && (
          <span className={styles.stylistCity}>
            {record.created_by_account.address_city}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <GalleryPhotoCardOrganism
      record={record}
      showHeart
      showWatermark={record.show_watermark}
      isFavorited={isFavorited}
      onFavoriteToggle={handleFavoriteToggle}
      onCardClick={handleCardClick}
      likeCount={record.like_count >= 3 ? record.like_count : null}
      fullWidth={isFullWidth}
      footer={footer}
    />
  );
});

/* ─── Component ─── */

export function ExploreGalleryGridOrganism({
  records,
  isFullWidth,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  favoritedIds,
  onFetchNextPage,
  onFavoriteToggle,
  onCardClick,
}: ExploreGalleryGridProps) {
  return (
    <>
      <div
        className={clsx(
          styles.galleryGrid,
          isFullWidth && styles.galleryGridFullWidth
        )}>
        {records.map(record => (
          <ExploreCardItem
            key={record.gallery_record_id}
            record={record}
            isFullWidth={isFullWidth}
            isFavorited={favoritedIds.has(record.gallery_record_id)}
            onFavoriteToggle={onFavoriteToggle}
            onCardClick={onCardClick}
          />
        ))}
      </div>

      {/* Sentinel: shared trigger (one IntersectionObserver recipe app-wide);
          the skeleton row below is this grid's own „loading more" indicator. */}
      <InfiniteScrollTriggerComposition
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        isFetchNextPageError={isFetchNextPageError}
        onFetchNextPage={onFetchNextPage}
        showSpinner={false}
      />

      {/* Loading more indicator */}
      {isFetchingNextPage && (
        <div className={styles.loadingMore}>
          <SkeletonAtom variant='rect' width='100%' height={200} />
          <SkeletonAtom variant='rect' width='100%' height={200} />
        </div>
      )}
    </>
  );
}

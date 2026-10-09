// UI/features/gallery/StyleDetailGallery.tsx
// Length filter strip + masonry photo gallery for Style Detail (W2.5 iter 1).
// CSS columns masonry (W1.2 vocabulary), infinite scroll, hover lift.

import { type CSSProperties, type ReactNode, memo } from 'react';
import { useTranslations } from 'next-intl';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { EyebrowAtom } from '../../components/Eyebrow/Eyebrow.atom';
import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import type { StyleRecord } from './hooks/useStyleDetailData';
import styles from './StyleDetailPage.module.css';

const LENGTH_ORDER: readonly NailLength[] = [
  NAIL_LENGTHS.SHORT,
  NAIL_LENGTHS.MEDIUM,
  NAIL_LENGTHS.LONG,
  NAIL_LENGTHS.XL,
];

const LENGTH_TKEY: Record<NailLength, string> = {
  [NAIL_LENGTHS.SHORT]: 'styleDetailLengthShort',
  [NAIL_LENGTHS.MEDIUM]: 'styleDetailLengthMedium',
  [NAIL_LENGTHS.LONG]: 'styleDetailLengthLong',
  [NAIL_LENGTHS.XL]: 'styleDetailLengthXL',
};

/* ─── Length filter strip ─────────────────────────────── */

interface StyleDetailLengthFilterProps {
  selectedLength: NailLength | null;
  lengthCounts: Record<NailLength, number>;
  // True while more pages remain unloaded — counts are then a lower bound, so
  // the badge renders "{count}+" instead of an authoritative total.
  hasNextPage: boolean;
  onSelect: (length: NailLength | null) => void;
}

export function StyleDetailLengthFilterMolecule({
  selectedLength,
  lengthCounts,
  hasNextPage,
  onSelect,
}: StyleDetailLengthFilterProps) {
  const t = useTranslations('pages.gallery');

  return (
    <section
      className={`${styles.filterSection} ${styles.staggerIn}`}
      style={{ '--stagger-index': 1 } as CSSProperties}
      aria-labelledby='length-filter-eyebrow'>
      <div
        className={styles.filterHeader}
        id='length-filter-eyebrow'
        aria-hidden='true'>
        <EyebrowAtom variant='chip'>
          {t('styleDetailFilterEyebrow')}
        </EyebrowAtom>
      </div>
      <ul className={styles.filterChipsRow}>
        <li>
          <button
            type='button'
            className={`${styles.filterChip} ${
              selectedLength === null ? styles.filterChipActive : ''
            }`}
            onClick={() => onSelect(null)}
            aria-pressed={selectedLength === null}>
            {t('styleDetailFilterAll')}
          </button>
        </li>
        {LENGTH_ORDER.map(len => {
          const tKey = LENGTH_TKEY[len];
          const count = lengthCounts[len];
          const isActive = selectedLength === len;
          return (
            <li key={len}>
              <button
                type='button'
                className={`${styles.filterChip} ${
                  isActive ? styles.filterChipActive : ''
                }`}
                onClick={() => onSelect(len)}
                aria-pressed={isActive}>
                <span>{t(tKey)}</span>
                {count > 0 && (
                  <span className={styles.filterChipCount}>
                    {count}
                    {hasNextPage ? '+' : ''}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ─── Masonry gallery section ───────────────────────────
 * Includes section header (eyebrow + title + count) + masonry +
 * infinite-scroll sentinel + loading skeletons. */

interface StyleDetailGallerySectionProps {
  records: readonly StyleRecord[];
  favoritedIds: Set<string>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onFetchNextPage: () => void;
  onFavoriteToggle: (recordId: string) => void;
  onCardClick: (recordId: string) => void;
}

/* ─── Card item (stable props for React.memo) ───────────
 * Extracted + memoized so favorite toggles / isFetchingNextPage flips /
 * length-filter changes on the parent don't re-render every card in the
 * (unbounded) masonry. Mirrors explore/components ExploreCardItem. */

interface StyleDetailCardItemProps {
  record: StyleRecord;
  isFavorited: boolean;
  onFavoriteToggle: (recordId: string) => void;
  onCardClick: (recordId: string) => void;
}

const StyleDetailCardItem = memo(function StyleDetailCardItem({
  record,
  isFavorited,
  onFavoriteToggle,
  onCardClick,
}: StyleDetailCardItemProps) {
  const handleFavoriteToggle = () => onFavoriteToggle(record.gallery_record_id);
  const handleCardClick = () => onCardClick(record.gallery_record_id);
  const footer: ReactNode =
    record.created_by_account == null ? undefined : (
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
        }}>
        {record.created_by_account.display_name}
      </span>
    );

  return (
    <div className={styles.masonryItem}>
      <GalleryPhotoCardOrganism
        record={record}
        showHeart
        showWatermark={record.show_watermark}
        isFavorited={isFavorited}
        onFavoriteToggle={handleFavoriteToggle}
        onCardClick={handleCardClick}
        likeCount={record.like_count >= 3 ? record.like_count : null}
        footer={footer}
      />
    </div>
  );
});

export function StyleDetailGallerySectionOrganism({
  records,
  favoritedIds,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onFetchNextPage,
  onFavoriteToggle,
  onCardClick,
}: StyleDetailGallerySectionProps) {
  const t = useTranslations('pages.gallery');

  return (
    <section
      className={`${styles.gallerySection} ${styles.staggerIn}`}
      style={{ '--stagger-index': 2 } as CSSProperties}
      aria-labelledby='style-gallery-title'>
      <header className={styles.galleryHeader}>
        <div>
          <h2 className={styles.galleryTitle} id='style-gallery-title'>
            {t('styleDetailGalleryTitle')}{' '}
            {/* Licznik danych w serif-nagłówku → sans tabular (global utility
             * .data-count; Marcellus renderuje 0 jak O). */}
            <span className={styles.galleryCount}>
              (
              <span className='data-count'>
                {records.length}
                {hasNextPage ? '+' : ''}
              </span>
              )
            </span>
          </h2>
        </div>
      </header>

      <div className={styles.masonry}>
        {records.map(record => (
          <StyleDetailCardItem
            key={record.gallery_record_id}
            record={record}
            isFavorited={favoritedIds.has(record.gallery_record_id)}
            onFavoriteToggle={onFavoriteToggle}
            onCardClick={onCardClick}
          />
        ))}
      </div>

      {/* Shared sentinel (one IntersectionObserver recipe app-wide). The
          hand-rolled copy here mounted its sentinel conditionally while the
          observer effect ran once, and a failed page looked like the end. */}
      <InfiniteScrollTriggerComposition
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        isFetchNextPageError={isFetchNextPageError}
        onFetchNextPage={onFetchNextPage}
        showSpinner={false}
      />

      {isFetchingNextPage && (
        <div className={styles.loadingMore}>
          <SkeletonAtom variant='rect' width='100%' height={200} />
          <SkeletonAtom variant='rect' width='100%' height={200} />
        </div>
      )}
    </section>
  );
}

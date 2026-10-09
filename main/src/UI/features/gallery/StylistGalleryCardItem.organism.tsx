import { memo } from 'react';
import {
  GalleryPhotoCardOrganism,
  type GalleryRecordView,
} from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import type { StylistGalleryRecord } from '../shared/gallery/hooks/useStylistGallery';
import type { PairedGalleryRecord } from './hooks/usePairedStylistGallery';

interface StylistCardItemProps {
  record: StylistGalleryRecord | PairedGalleryRecord;
  usePaired: boolean;
  showWatermark: boolean;
  isFavorited: boolean;
  /** False while the heart state is unknown (favorites not fully loaded). */
  isFavoriteResolved: boolean;
  isFullWidth: boolean;
  /** Only a logged-in CLIENT can favorite (endpoint requires ClientAccount) —
   *  a guest got 401 and a stylist 403 from a heart that looked live. */
  canFavorite: boolean;
  onFavoriteToggle: (recordId: string) => void;
  /** When set, card click fires this callback instead of navigating to photo detail. */
  onCardClick?: (recordId: string) => void;
}

export const StylistCardItemOrganism = memo(function StylistCardItem({
  record,
  usePaired,
  showWatermark,
  isFavorited,
  isFavoriteResolved,
  isFullWidth,
  canFavorite,
  onFavoriteToggle,
  onCardClick,
}: StylistCardItemProps) {
  const cardRecord: GalleryRecordView = {
    gallery_record_id: record.gallery_record_id,
    asset_url: record.asset_url,
    nail_length: record.nail_length,
    is_pinned: usePaired && 'is_pinned' in record ? record.is_pinned : false,
    colors: record.colors,
    traits: record.traits,
    created_at: record.created_at,
  };
  const handleFavoriteToggle = () => onFavoriteToggle(record.gallery_record_id);

  const handleCardClick = () => onCardClick?.(record.gallery_record_id);

  return (
    <GalleryPhotoCardOrganism
      record={cardRecord}
      showHeart={!onCardClick && canFavorite}
      showWatermark={showWatermark}
      isFavorited={isFavorited}
      favoritePending={!isFavoriteResolved}
      onFavoriteToggle={handleFavoriteToggle}
      showPinBadge={usePaired && !onCardClick}
      fullWidth={isFullWidth}
      {...(onCardClick ? { onCardClick: handleCardClick } : {})}
    />
  );
});

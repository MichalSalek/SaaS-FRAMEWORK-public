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
  /** A tap on the photo: opens it, or (with `pick`) chooses it for a session. */
  onCardClick?: (recordId: string) => void;
  /** With `onCardClick`: the card is a choice (session pick mode). Flat
   *  fields, so the memo below still compares them by value. */
  pick?: {
    selected: boolean;
    pending: boolean;
    addLabel: string;
    removeLabel: string;
  };
}

/* `pick` is rebuilt by the parent on every render; comparing its four fields
 * keeps the memo working for the cards whose state did not change. */
function sameProps(a: StylistCardItemProps, b: StylistCardItemProps): boolean {
  const { pick: pa, ...ra } = a;
  const { pick: pb, ...rb } = b;
  const keys = Object.keys(ra) as (keyof typeof ra)[];
  if (keys.length !== Object.keys(rb).length) {
    return false;
  }
  if (keys.some(key => ra[key] !== rb[key])) {
    return false;
  }
  return (
    pa?.selected === pb?.selected &&
    pa?.pending === pb?.pending &&
    pa?.addLabel === pb?.addLabel &&
    pa?.removeLabel === pb?.removeLabel
  );
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
  pick,
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
      showHeart={pick === undefined && canFavorite}
      showWatermark={showWatermark}
      isFavorited={isFavorited}
      favoritePending={!isFavoriteResolved}
      onFavoriteToggle={handleFavoriteToggle}
      showPinBadge={usePaired && pick === undefined}
      fullWidth={isFullWidth}
      {...(onCardClick ? { onCardClick: handleCardClick } : {})}
      {...(pick !== undefined ? { selection: pick } : {})}
    />
  );
}, sameProps);

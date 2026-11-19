import { getLocalizedTaxonomyName } from '../../../domain/gallery/gallery-taxonomy.locale';
import { type ReactNode, useState } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import {
  CheckIcon,
  HeartIcon,
  PlusIcon,
  ShareNetworkIcon,
  PushPinIcon,
} from '@phosphor-icons/react';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import {
  NAIL_LENGTHS,
  type NailLength,
} from '@kernel/domain/gallery/nail-length.config';
import { ImagePlaceholderAtom } from '../ImagePlaceholder/ImagePlaceholder.atom';
import {
  getCloudinaryFrameSrcSet,
  getCloudinaryFrameUrl,
} from '../../../application/cloudinary/cloudinary-url.utils';
import { GalleryPhotoCardInfoMolecule } from './GalleryPhotoCardInfo.molecule';
import styles from './GalleryPhotoCard.module.css';

/* ─── Types ─── */

/** Shape of a gallery record as returned by the API list endpoints. */
export interface GalleryRecordView {
  gallery_record_id: string;
  asset_url: string;
  // Optional: some surfaces (e.g. favorites list) have no nail_length in their
  // DTO. Do NOT fabricate a value — buildAltText skips the length clause when
  // absent, so alt text never announces a false length to screen readers.
  nail_length?: NailLength;
  is_pinned: boolean;
  colors: ColorDTO[];
  traits: TraitDTO[];
  created_at: string | Date;
  like_count?: number;
  created_by_account?: {
    account_id: string;
    display_name: string | null;
    vanity_url: string | null;
    address_city: string | null;
  };
}

export interface GalleryPhotoCardProps {
  record: GalleryRecordView;
  /** Show the heart / favorite button */
  showHeart?: boolean;
  /** Whether the record is favorited by the current user */
  isFavorited?: boolean;
  /** Callback when the favorite button is tapped */
  onFavoriteToggle?: () => void;
  /** The favorite state is not known yet (the viewer's favorites are still
   *  loading or failed). The heart renders inactive and busy instead of an
   *  empty heart that would read as a confirmed „not favorited". */
  favoritePending?: boolean;
  /** Show the share button (bottom-right overlay) */
  showShare?: boolean;
  /** Callback when the share button is tapped */
  onShare?: () => void;
  /** A receipt beside the share action, owned by the caller after confirmed clipboard success. */
  shareFeedback?: ReactNode;
  shareLabel?: string;
  /** Show the pin badge / pin toggle */
  showPinBadge?: boolean;
  /** Override record.is_pinned with local state */
  isPinned?: boolean;
  /** When provided, the pin badge becomes a clickable toggle */
  onPinToggle?: (recordId: string) => void;
  /** Override like count (N4 social proof: shown when >= 3) */
  likeCount?: number | null;
  /** Show watermark overlay (e.g. FREE plan branding) */
  showWatermark?: boolean;
  /** Additional content below traits (e.g. stylist attribution) */
  footer?: ReactNode;
  /** Callback when the card image area is tapped */
  onCardClick?: () => void;
  /** The card is a CHOICE, not a way to the photo: a tap on it (`onCardClick`)
   *  puts the photo in or takes it out, and the mark in the corner shows
   *  which (a plus on the dark disc = can be added, a check on the white disc
   *  = is in). The labels are the accessible name of the tap in each state. */
  selection?: {
    selected: boolean;
    /** The change is being saved: the card ignores taps until it settles. */
    pending?: boolean;
    addLabel: string;
    removeLabel: string;
  };
  /** Full-width layout mode (no border-radius, square aspect ratio) */
  fullWidth?: boolean;
  /** Photo-only public portfolio tile. Details remain available to its caller. */
  compact?: boolean;
  className?: string;
}

/* ─── Alt text helpers ─── */

/**
 * Build descriptive alt text for a gallery photo from its traits.
 * WCAG 2.1 AA (1.1.1 Non-text Content): every image needs a meaningful
 * text alternative. SEO bonus: alt = inline keyword density.
 *
 * Composed from length + colors + traits (translated), with generic fallback.
 * GalleryRecord schema has no `description` field — alt is fully derived.
 */
function buildAltText(
  record: GalleryRecordView,
  nailLengthLabels: Record<NailLength, string>,
  altLengthSuffix: string,
  altFallback: string,
  locale: string
): string {
  const parts: string[] = [];

  if (record.nail_length) {
    const lengthLabel = nailLengthLabels[record.nail_length];
    if (lengthLabel) {
      parts.push(`${lengthLabel} ${altLengthSuffix}`);
    }
  }

  if (record.colors.length > 0) {
    parts.push(
      record.colors
        .map(c => getLocalizedTaxonomyName(c.name, locale))
        .join(', ')
    );
  }

  if (record.traits.length > 0) {
    parts.push(
      record.traits
        .map(t => getLocalizedTaxonomyName(t.name, locale))
        .join(', ')
    );
  }

  return parts.length > 0 ? parts.join(', ') : altFallback;
}

/* ─── Component ─── */

export function GalleryPhotoCardOrganism({
  record,
  showHeart = false,
  isFavorited = false,
  onFavoriteToggle,
  favoritePending = false,
  showShare = false,
  onShare,
  shareFeedback,
  shareLabel,
  showPinBadge = false,
  isPinned: isPinnedOverride,
  onPinToggle,
  likeCount = null,
  showWatermark = false,
  footer,
  onCardClick,
  selection,
  fullWidth = false,
  compact = false,
  className,
}: GalleryPhotoCardProps) {
  const locale = useLocale();
  const t = useTranslations('galleryCard');
  // Keyed by the kernel union, not a bare `string`: a length added to
  // NAIL_LENGTHS without an entry here is a type error instead of silently
  // missing from the photo's alt text.
  const nailLengthLabels: Record<NailLength, string> = {
    [NAIL_LENGTHS.SHORT]: t('nailLength.short'),
    [NAIL_LENGTHS.MEDIUM]: t('nailLength.medium'),
    [NAIL_LENGTHS.LONG]: t('nailLength.long'),
    [NAIL_LENGTHS.XL]: t('nailLength.xl'),
  };
  const pinned = isPinnedOverride ?? record.is_pinned;

  // Fall back to the placeholder when the image FAILS to load (CDN 404/timeout),
  // not only when asset_url is empty; otherwise a deleted Cloudinary object
  // shows a broken-image icon. The list is keyed by gallery_record_id, so a new
  // record is a fresh instance (state resets without an effect on src change).
  const [imgError, setImgError] = useState(false);

  const altLengthSuffix = t('altLengthSuffix');
  const altFallback = t('altFallback');
  const altText = buildAltText(
    record,
    nailLengthLabels,
    altLengthSuffix,
    altFallback,
    locale
  );

  return (
    <div
      className={clsx(
        styles.card,
        fullWidth && styles.cardFullWidth,
        compact && styles.cardCompact,
        className
      )}>
      {/* DECISION: opening the photo is carried by its OWN stretched <button> beneath the actions,
          not `role='button'` on the frame: a frame-control holding the heart, pin and share is a
          control in a control a screen reader cannot describe (WCAG 4.1.2). The button sits at
          z-index 1 and the actions at 2, so they lie ABOVE it and catch their own clicks.
          Accepted cost: the button lies OVER the photo, so a long press on mobile opens the
          browser menu for the button, not the image, and the system "Save image" disappears.
          Correct semantics outweigh saving other people's styles, which the
          product watermarks on the Free plan anyway. If it must return, NOT by going back to
          role='button' on the frame: take the button off the layer (pointer-events) and handle
          the pointer on the container, leaving the button for the keyboard only. */}
      <div
        className={clsx(
          styles.imageWrapper,
          styles.imageResolve,
          showWatermark && styles.watermark
        )}
        data-gallery-record-id={record.gallery_record_id}>
        {record.asset_url && !imgError ? (
          <img
            src={getCloudinaryFrameUrl(record.asset_url, '3:4', 800)}
            srcSet={getCloudinaryFrameSrcSet(record.asset_url, '3:4')}
            // The grid, not the card, decides the tile's width (one photo
            // across by default, two or more in the tile views). `auto` lets
            // the browser use the laid-out width of a lazy image; where it is
            // not supported the list after it assumes the default full width.
            sizes='auto, (min-width: 768px) 400px, 100vw'
            alt={altText}
            loading='lazy'
            className={styles.image}
            onError={() => setImgError(true)}
          />
        ) : (
          <ImagePlaceholderAtom size='lg' />
        )}

        {onCardClick && selection === undefined && (
          <button
            type='button'
            className={styles.openPhotoButton}
            onClick={onCardClick}
            aria-label={t('openPhoto')}
          />
        )}
        {onCardClick && selection !== undefined && (
          <>
            <button
              type='button'
              className={styles.openPhotoButton}
              onClick={onCardClick}
              disabled={selection.pending || undefined}
              aria-busy={selection.pending || undefined}
              aria-pressed={selection.selected}
              aria-label={
                selection.selected ? selection.removeLabel : selection.addLabel
              }
            />
            {/* The mark is drawn, not tapped: the whole photo is the control. */}
            <span
              className={styles.selectMark}
              data-selected={selection.selected || undefined}
              data-pending={selection.pending || undefined}
              aria-hidden='true'>
              {selection.selected ? (
                <CheckIcon size={22} weight='bold' />
              ) : (
                <PlusIcon size={22} weight='bold' />
              )}
            </span>
          </>
        )}

        {/* Pin toggle / badge */}
        {showPinBadge && onPinToggle ? (
          <button
            type='button'
            className={clsx(
              styles.pinToggle,
              pinned && styles.pinToggleActive,
              showHeart && styles.pinnedBadgeWithHeart
            )}
            onClick={e => {
              e.stopPropagation();
              onPinToggle(record.gallery_record_id);
            }}
            aria-label={pinned ? t('unpin') : t('pin')}>
            <PushPinIcon size={14} weight={pinned ? 'fill' : 'regular'} />
          </button>
        ) : showPinBadge && pinned ? (
          /* A mark, not a sentence (owner): a pill with „Przypięte do profilu”
             breaks into two lines over the photo on a two-column card. The pin
             sits on the same disc the pin button uses when it is on; the words
             stay as the accessible name. */
          <span
            className={clsx(
              styles.pinnedBadge,
              showHeart && styles.pinnedBadgeWithHeart
            )}
            role='img'
            aria-label={t('pinned')}
            title={t('pinned')}>
            <PushPinIcon size={14} weight='fill' aria-hidden='true' />
          </span>
        ) : null}

        {/* Favorite heart */}
        {showHeart && (
          <button
            type='button'
            className={clsx(styles.heartButton, 'press-feedback')}
            onClick={e => {
              e.stopPropagation();
              onFavoriteToggle?.();
            }}
            disabled={favoritePending || undefined}
            aria-busy={favoritePending || undefined}
            data-liked={isFavorited || undefined}
            aria-label={isFavorited ? t('unfavorite') : t('favorite')}>
            {/* Liked = brand-colored heart on a WHITE disc (rule in the
             * module, `[data-liked]`); not liked = white heart on the dark
             * scrim. The dark raspberry brand color vanishes on a dark scrim. */}
            <HeartIcon
              size={22}
              weight={isFavorited ? 'fill' : 'regular'}
              color={
                isFavorited
                  ? 'var(--color-primary)'
                  : 'var(--color-on-photo-overlay)'
              }
            />
          </button>
        )}

        {/* Share button */}
        {!compact && showShare && (
          <button
            type='button'
            className={styles.shareButton}
            onClick={e => {
              e.stopPropagation();
              onShare?.();
            }}
            aria-label={shareLabel ?? t('share')}
            title={shareLabel}>
            <ShareNetworkIcon size={18} />
          </button>
        )}
        {shareFeedback != null && (
          <div className={styles.shareResult}>{shareFeedback}</div>
        )}
      </div>

      {!compact && (
        <GalleryPhotoCardInfoMolecule
          record={record}
          likeCount={likeCount}
          footer={footer}
        />
      )}
    </div>
  );
}

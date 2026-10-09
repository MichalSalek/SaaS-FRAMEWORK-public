import { getLocalizedTaxonomyName } from '../../../domain/gallery/gallery-taxonomy.locale';
import { type ReactNode, useState } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import {
  HeartIcon,
  ShareNetworkIcon,
  PushPinIcon,
} from '@phosphor-icons/react';
import type { ColorDTO, TraitDTO } from '@kernel/models/db_models.manual.dto';
import {
  NAIL_LENGTHS,
  type NailLength,
} from '@kernel/domain/gallery/nail-length.config';
import { ImagePlaceholderAtom } from '../ImagePlaceholder/ImagePlaceholder.atom';
import { ColorDotAtom } from '../ColorDot/ColorDot.atom';
import { ChipAtom, ChipGroupMolecule } from '../Chip/Chip.atom';
import { getCloudinaryThumbUrl } from '../../../application/cloudinary/cloudinary-url.utils';
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
  /** Full-width layout mode (no border-radius, square aspect ratio) */
  fullWidth?: boolean;
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
  showPinBadge = false,
  isPinned: isPinnedOverride,
  onPinToggle,
  likeCount = null,
  showWatermark = false,
  footer,
  onCardClick,
  fullWidth = false,
  className,
}: GalleryPhotoCardProps) {
  const locale = useLocale();
  const t = useTranslations('galleryCard');
  // Kluczowanie unią z kernela, nie gołym `string`: mapa była indeksowana
  // ręcznie zlowercase'owaną wartością, więc dopisanie piątej długości do
  // NAIL_LENGTHS kompilowało się bez szmeru i po cichu gubiło ją w tekście
  // alternatywnym zdjęcia. Teraz brak wpisu = błąd typów.
  const nailLengthLabels: Record<NailLength, string> = {
    [NAIL_LENGTHS.SHORT]: t('nailLength.short'),
    [NAIL_LENGTHS.MEDIUM]: t('nailLength.medium'),
    [NAIL_LENGTHS.LONG]: t('nailLength.long'),
    [NAIL_LENGTHS.XL]: t('nailLength.xl'),
  };
  const pinned = isPinnedOverride ?? record.is_pinned;

  // Fallback na placeholder gdy obraz NIE załaduje się (404/timeout z CDN), nie
  // tylko gdy asset_url jest puste — inaczej zniknięty obiekt Cloudinary daje
  // złamaną ikonkę obrazka. Lista jest keyowana po gallery_record_id, więc nowy
  // rekord = świeża instancja (reset stanu bez ręcznego efektu na zmianę src).
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
        className
      )}>
      {/* DECISION (nie usuwaj tego komentarza):
          Otwieranie zdjęcia niesie WŁASNY, rozciągnięty <button> pod akcjami,
          a nie `role='button'` na kadrze. Wcześniej kadr był kontrolką, a serce,
          pinezka i udostępnianie leżały w jego środku — kontrolka w kontrolce,
          której czytnik nie umie opisać (WCAG 4.1.2). Występowało to na czterech
          głównych widokach naraz (Odkrywaj, Galeria, Detal stylu, Ulubione),
          bo wszystkie podają onCardClick razem z showHeart/showPinBadge.
          Przycisk siedzi na z-index 1, akcje mają 2 — więc leżą NAD nim i łapią
          swoje kliknięcia same, bez walki o kolejność zdarzeń.

          ŚWIADOMY KOSZT: przycisk leży NAD zdjęciem, więc długie przytrzymanie na
          mobile otwiera menu przeglądarki dla przycisku, a nie dla obrazu — znika
          systemowe „Zapisz obraz". Wcześniej kadr był rodzicem, nie warstwą, więc
          przytrzymanie trafiało w <img>. Przyjęte: poprawna semantyka na czterech
          widowniach naraz jest warta więcej niż zapisywanie cudzych stylizacji,
          które produkt i tak znakuje znakiem wodnym na planie Free. Gdyby kiedyś
          miało wrócić — NIE przez powrót do role='button' na kadrze; wtedy trzeba
          zdjąć przycisk z warstwy (pointer-events) i obsłużyć wskaźnik na
          kontenerze, zostawiając przycisk wyłącznie dla klawiatury. */}
      <div
        className={clsx(
          styles.imageWrapper,
          styles.imageResolve,
          showWatermark && styles.watermark
        )}
        data-gallery-record-id={record.gallery_record_id}>
        {record.asset_url && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element -- gallery images are user-uploaded to external CDN
          <img
            src={getCloudinaryThumbUrl(record.asset_url)}
            srcSet={`${getCloudinaryThumbUrl(record.asset_url, 400)} 1x, ${getCloudinaryThumbUrl(record.asset_url, 800)} 2x`}
            alt={altText}
            loading='lazy'
            className={styles.image}
            onError={() => setImgError(true)}
          />
        ) : (
          <ImagePlaceholderAtom size='lg' />
        )}

        {onCardClick && (
          <button
            type='button'
            className={styles.openPhotoButton}
            onClick={onCardClick}
            aria-label={t('openPhoto')}
          />
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
          <span
            className={clsx(
              styles.pinnedBadge,
              showHeart && styles.pinnedBadgeWithHeart
            )}>
            {t('pinned')}
          </span>
        ) : null}

        {/* Favorite heart */}
        {showHeart && (
          <button
            type='button'
            className={clsx(styles.heartButton, 'haptic-press')}
            onClick={e => {
              e.stopPropagation();
              onFavoriteToggle?.();
            }}
            disabled={favoritePending || undefined}
            aria-busy={favoritePending || undefined}
            aria-label={isFavorited ? t('unfavorite') : t('favorite')}>
            {/* Polubione = złoto brandu na ink-scrimie (spójne ze złotym sercem
             * BottomTabBar); error-red był jedyną czerwienią w apce i czytał się
             * jak default biblioteki (census S26). Scrim jest mode-invariant
             * ciemny, więc jasny gold trzyma kontrast w obu trybach. */}
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
        {showShare && (
          <button
            type='button'
            className={styles.shareButton}
            onClick={e => {
              e.stopPropagation();
              onShare?.();
            }}
            aria-label={t('share')}>
            <ShareNetworkIcon size={18} />
          </button>
        )}
      </div>

      <div className={styles.info}>
        {record.colors.length > 0 && (
          <div className={styles.colorDots}>
            {record.colors.map(c => (
              <ColorDotAtom key={c.id} color={c.hex_code} size='sm' />
            ))}
          </div>
        )}

        {record.traits.length > 0 && (
          <ChipGroupMolecule className={styles.traitChips}>
            {record.traits.map(t => (
              <ChipAtom
                key={t.id}
                label={getLocalizedTaxonomyName(t.name, locale)}
                size='sm'
              />
            ))}
          </ChipGroupMolecule>
        )}

        {/* N4 social proof: like count badge shown when >= 3 */}
        {likeCount != null && likeCount >= 3 && (
          <div className={styles.likeCount}>
            <HeartIcon size={14} />
            <span>{likeCount}</span>
          </div>
        )}

        {footer}
      </div>
    </div>
  );
}

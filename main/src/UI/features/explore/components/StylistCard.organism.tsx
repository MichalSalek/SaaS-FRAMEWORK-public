/**
 * StylistCard — single creator card.
 *
 * Layout: solid color-mix cover (deterministic hue per name, brand colour
 * when set; NO gradients — floor 7×ZERO) + PRO/IG badges →
 * avatar overlap → name + city → photo + bookmark stats → 3-tile thumb
 * strip (or empty hint) → footer with IG link + "View profile" CTA.
 *
 * DECISION (nie usuwaj tego komentarza):
 * StylistPublicListItemDTO ma tylko avatar_url, brak cover_image_url i brak
 * próbnych zdjęć portfolio. Cover + thumb strip to płaskie wypełnienia
 * (color-mix) z deterministycznym hue offsetem na podstawie display_name —
 * zapewnia to wizualną różnorodność (każda stylistka ma "własną" paletę) bez
 * dodatkowych endpointów. Gdy DTO doda cover_image_url / sample_photos,
 * podmień wypełnienia na <Image>, struktura pozostaje.
 */

import { useTranslations } from 'next-intl';
import {
  MapPinIcon,
  CameraIcon,
  BookmarkSimpleIcon,
  ArrowRightIcon,
  InstagramLogoIcon,
} from '@phosphor-icons/react';
import type { StylistPublicListItemDTO } from '@kernel/models/public/public.dto';
import { isBrandAccentHex } from '@kernel/domain/user-and-account/branding.config';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { getCoverHues, getThumbHue } from './stylistCardHelpers';
import styles from './ExploreStylistsTab.module.css';

interface StylistCardProps {
  stylist: StylistPublicListItemDTO;
  staggerIndex: number;
  onOpen: (stylist: StylistPublicListItemDTO) => void;
}

export function StylistCardOrganism({
  stylist,
  staggerIndex,
  onOpen,
}: StylistCardProps) {
  const t = useTranslations('pages.explore');
  const tLabels = useTranslations('labels');
  const displayName = stylist.display_name ?? tLabels('stylistFallback');
  const hues = getCoverHues(displayName);
  // Branding-light krok 2: pełny kolor marki (mix 100%, jak profil/galeria) —
  // backend już zamaskował planem; guard isBrandAccentHex = defense-in-depth.
  const branded = Boolean(
    stylist.brand_accent_color && isBrandAccentHex(stylist.brand_accent_color)
  );
  const thumbHues = [
    getThumbHue(displayName, 0),
    getThumbHue(displayName, 1),
    getThumbHue(displayName, 2),
  ];

  const handleClick = () => onOpen(stylist);

  const cityLabel = stylist.city ?? t('stylistsCardCityFallback');
  const igHandle = stylist.instagram_handle?.replace(/^@/, '');
  const igHref = igHandle ? `https://instagram.com/${igHandle}` : null;

  // DECISION (nie usuwaj tego komentarza):
  // The card is a plain <article>, NOT role="button". It contains genuine
  // interactive children (the "View profile" <button> and the Instagram <a>),
  // and nesting interactive elements inside a button-role container is an
  // invalid ARIA pattern that also produces a duplicate tab stop. Navigation
  // to the profile happens via the explicit CTA button below — "tap anywhere
  // on the card" was intentionally dropped to keep the a11y tree valid.
  return (
    <article
      className={`${styles.card} ${styles.staggerIn}`}
      data-branded={branded ? '' : undefined}
      style={
        {
          '--stagger-index': staggerIndex,
          '--cover-hue': branded ? stylist.brand_accent_color : hues.primary,
          '--cover-hue-2': hues.accent,
          ...(branded ? { '--cover-mix': '100%' } : {}),
        } as React.CSSProperties
      }>
      <div className={styles.cardCover}>
        <div className={styles.cardCoverBadges}>
          {stylist.is_pro_or_higher && (
            <span className={styles.badgePro} title={t('stylistsCardBadgePro')}>
              {t('stylistsCardBadgePro')}
            </span>
          )}
          {stylist.instagram_handle && (
            <span
              className={styles.badgeIg}
              title={t('stylistsCardBadgeInstagram')}
              aria-label={t('stylistsCardBadgeInstagram')}>
              <InstagramLogoIcon size={13} weight='bold' />
            </span>
          )}
        </div>
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardAvatar}>
          <AvatarAtom
            src={stylist.avatar_url ?? undefined}
            name={displayName}
            size='lg'
          />
        </div>

        <div className={styles.cardHeader}>
          <h3 className={`${styles.cardName} fontAccent`}>{displayName}</h3>
          <span className={styles.cardLocation} title={cityLabel}>
            <MapPinIcon
              size={13}
              weight='fill'
              className={styles.cardLocationIcon}
              aria-hidden='true'
            />
            {cityLabel}
          </span>
        </div>

        <div className={styles.cardStats}>
          <span className={styles.cardStat}>
            <CameraIcon
              size={13}
              className={styles.cardStatIcon}
              aria-hidden='true'
            />
            {t('stylistsCardPhotos', { count: stylist.photo_count })}
          </span>
          <span className={styles.cardStat}>
            <BookmarkSimpleIcon
              size={13}
              className={styles.cardStatIcon}
              aria-hidden='true'
            />
            {t('stylistsCardBookmarks', { count: stylist.bookmark_count })}
          </span>
        </div>

        {stylist.photo_count > 0 ? (
          <div
            className={styles.cardThumbStrip}
            aria-label={t('stylistsCardPreviewLabel')}>
            {thumbHues.map((hue, i) => (
              <div
                key={i}
                className={styles.cardThumb}
                style={{ '--thumb-hue': hue } as React.CSSProperties}
                aria-hidden='true'
              />
            ))}
          </div>
        ) : (
          <div className={styles.cardThumbStrip}>
            <div className={styles.cardThumbEmpty}>
              {t('stylistsCardNoPhotos')}
            </div>
          </div>
        )}

        <div className={styles.cardFooter}>
          {igHref ? (
            <a
              href={igHref}
              target='_blank'
              rel='noopener noreferrer'
              className={styles.cardIgHandle}>
              <InstagramLogoIcon
                size={13}
                weight='bold'
                className={styles.cardIgIcon}
                aria-hidden='true'
              />
              @{igHandle}
            </a>
          ) : (
            <span />
          )}
          <button
            type='button'
            className={`${styles.cardCta} haptic-press`}
            onClick={handleClick}>
            {t('stylistsCardOpenProfile')}
            <ArrowRightIcon
              size={14}
              weight='bold'
              className={styles.cardCtaIcon}
            />
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * StylistCard — one stylist in the public list („Odkryj”, „Stylistki”).
 *
 * White box: avatar, name and city, then up to three of her real pinned works
 * (`sample_photo_urls`, the public profile's own visibility rule), counts and
 * the „Zobacz profil” button.
 *
 * DECISION: the card no longer paints a pastel cover and three flat "thumbnail" fills from a hash
 * of the name (they read as images that failed to load); the list DTO now carries real works, so a
 * stylist with no pins shows one quiet line instead.
 */

import { useTranslations } from 'next-intl';
import {
  MapPinIcon,
  CameraIcon,
  BookmarkSimpleIcon,
  InstagramLogoIcon,
} from '@phosphor-icons/react';
import type { StylistPublicListItemDTO } from '@kernel/models/public/public.dto';
import {
  getCloudinaryFrameSrcSet,
  getCloudinaryFrameUrl,
} from '../../../../application/cloudinary/cloudinary-url.utils';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ExternalLinkAtom } from '../../../components/ExternalLink/ExternalLink.atom';
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
  // `||`: a stylist onboarded with the role alone has an empty name.
  const displayName = stylist.display_name || tLabels('stylistFallback');
  const handleClick = () => onOpen(stylist);

  const cityLabel = stylist.city ?? t('stylistsCardCityFallback');
  const igHandle = stylist.instagram_handle?.replace(/^@/, '');
  const igHref = igHandle ? `https://instagram.com/${igHandle}` : null;

  // DECISION: the card is a plain <article>, NOT role="button". It contains genuine interactive
  // children (the "View profile" <button> and the Instagram <a>), and nesting interactive elements
  // inside a button-role container is invalid ARIA and produces a duplicate tab stop. Navigation
  // happens via the explicit CTA button; "tap anywhere on the card" was dropped to keep the a11y
  // tree valid.
  return (
    <article
      className={`${styles.card} ${styles.staggerIn}`}
      style={{ '--stagger-index': staggerIndex } as React.CSSProperties}>
      <div className={styles.cardHead}>
        <AvatarAtom
          src={stylist.avatar_url ?? undefined}
          name={displayName}
          size='md'
          decorative
        />
        <div className={styles.cardIdentity}>
          <h3 className={styles.cardName}>{displayName}</h3>
          <span className={styles.cardLocation}>
            <MapPinIcon
              size={14}
              weight='fill'
              className={styles.cardLocationIcon}
              aria-hidden='true'
            />
            {cityLabel}
          </span>
        </div>
      </div>

      {stylist.sample_photo_urls.length > 0 ? (
        <ul
          className={styles.cardThumbStrip}
          aria-label={t('stylistsCardPreviewLabel')}>
          {stylist.sample_photo_urls.map(url => (
            <li key={url} className={styles.cardThumb}>
              <img
                src={getCloudinaryFrameUrl(url, '3:4', 200)}
                srcSet={getCloudinaryFrameSrcSet(url, '3:4')}
                sizes='(min-width: 720px) 160px, 30vw'
                alt=''
                loading='lazy'
                decoding='async'
                className={styles.cardThumbImg}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.cardEmpty}>{t('stylistsCardNoPhotos')}</p>
      )}

      <div className={styles.cardStats}>
        <span className={styles.cardStat}>
          <CameraIcon
            size={14}
            className={styles.cardStatIcon}
            aria-hidden='true'
          />
          {t('stylistsCardPhotos', { count: stylist.photo_count })}
        </span>
        {/* „0 polubień” only advertised an empty profile: the count shows once
            there is one. */}
        {stylist.bookmark_count > 0 && (
          <span className={styles.cardStat}>
            <BookmarkSimpleIcon
              size={14}
              className={styles.cardStatIcon}
              aria-hidden='true'
            />
            {t('stylistsCardBookmarks', { count: stylist.bookmark_count })}
          </span>
        )}
      </div>

      <div className={styles.cardFooter}>
        {igHref ? (
          <ExternalLinkAtom href={igHref} className={styles.cardIgHandle}>
            <InstagramLogoIcon
              size={14}
              weight='bold'
              className={styles.cardIgIcon}
              aria-hidden='true'
            />
            @{igHandle}
          </ExternalLinkAtom>
        ) : (
          <span />
        )}
        <ButtonAtom
          variant='outlined'
          size='sm'
          direction='forward'
          onClick={handleClick}>
          {t('stylistsCardOpenProfile')}
        </ButtonAtom>
      </div>
    </article>
  );
}

// UI/features/gallery/StylistExhibitHero.tsx
// Editorial cover hero for the Stylist Gallery — "entering a curator's studio".
// Avatar + name + business + city/Instagram + one line of numbers, in a white
// box on paper.
// Paired badge zostaje (stan pary). Chip „Portfolio" zdjęty S88.

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  InstagramLogoIcon,
  MapPinIcon,
} from '@phosphor-icons/react';
import { isBrandAccentHex } from '@kernel/domain/user-and-account/branding.config';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { ExternalLinkAtom } from '../../components/ExternalLink/ExternalLink.atom';
import { coverHueVars } from '../shared/gallery/coverHueVars';
import styles from './StylistGalleryPage.module.css';

interface StylistExhibitHeroProps {
  stylistId: string;
  displayName: string;
  businessName: string | null;
  city: string | null;
  instagram?: string | null;
  /** Branding-light krok 2: kolor marki z DTO (już zamaskowany planem na
   *  backendzie) barwi cover; null = deterministyczny hue z imienia. */
  brandAccentColor?: string | null;
  isPaired: boolean;
  totalCount: number;
  uniqueColors: number;
  uniqueStyles: number;
}

export function StylistExhibitHeroOrganism({
  stylistId,
  displayName,
  businessName,
  city,
  instagram,
  brandAccentColor,
  isPaired,
  totalCount,
  uniqueColors,
  uniqueStyles,
}: StylistExhibitHeroProps) {
  const t = useTranslations('pages.gallery');
  const igHandle = instagram?.replace(/^@/, '') ?? null;
  const showBusinessName =
    Boolean(businessName) && businessName !== displayName;
  // Branding-light krok 2: pełny kolor marki (mix 100%, jak public profile
  // S51 — mid-tone nie ma AA dla żadnego tekstu); guard isBrandAccentHex =
  // defense-in-depth przy renderze wartości z DB.
  const branded = Boolean(
    brandAccentColor && isBrandAccentHex(brandAccentColor)
  );

  return (
    <section
      className={styles.exhibitHero}
      data-branded={branded ? '' : undefined}
      style={
        {
          ...coverHueVars(displayName || stylistId),
          ...(branded
            ? {
                '--cover-hue': brandAccentColor,
                '--cover-mix': '100%',
                '--cover-mix-dark': '100%',
              }
            : {}),
        } as CSSProperties
      }>
      <div className={styles.exhibitBody}>
        <div className={styles.exhibitAvatar}>
          <AvatarAtom src={undefined} name={displayName} size='lg' />
        </div>

        <div className={styles.exhibitMeta}>
          <h1 className={styles.exhibitName}>{displayName}</h1>
          {showBusinessName && (
            <p className={styles.exhibitBusinessName}>{businessName}</p>
          )}
          {/* W przepływie pod nazwą, nie absolutnie w rogu: na 390 px pigułka
              nachodziła na nazwisko stylistki (S122). */}
          {isPaired && (
            <span className={styles.exhibitPairedBadge}>
              <CheckCircleIcon size={13} weight='fill' />
              {t('stylistExhibitPairedBadge')}
            </span>
          )}
        </div>

        {(city || igHandle) && (
          <div className={styles.exhibitInlineMeta}>
            {city && (
              <span className={styles.exhibitMetaItem}>
                <MapPinIcon size={14} weight='fill' />
                {city}
              </span>
            )}
            {igHandle && (
              <ExternalLinkAtom
                href={`https://instagram.com/${igHandle}`}
                className={`${styles.exhibitMetaItem} ${styles.exhibitMetaItemLink}`}>
                <InstagramLogoIcon size={14} weight='fill' />@{igHandle}
              </ExternalLinkAtom>
            )}
          </div>
        )}

        {/* One quiet line of numbers, not three framed pills: read-only
            facts must not look like chips to tap (S126). Each number stays
            with its noun (one unbreakable piece), the line wraps between. */}
        {totalCount > 0 && (
          <p className={styles.statsLine}>
            <span className={styles.stat}>
              <strong>{totalCount}</strong>{' '}
              {t('stylistExhibitStatPhotos', { count: totalCount })}
              {(uniqueColors > 0 || uniqueStyles > 0) && ','}
            </span>
            {uniqueColors > 0 && (
              <span className={styles.stat}>
                <strong>{uniqueColors}</strong>{' '}
                {t('stylistExhibitStatColors', { count: uniqueColors })}
                {uniqueStyles > 0 && ','}
              </span>
            )}
            {uniqueStyles > 0 && (
              <span className={styles.stat}>
                <strong>{uniqueStyles}</strong>{' '}
                {t('stylistExhibitStatStyles', { count: uniqueStyles })}
              </span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}

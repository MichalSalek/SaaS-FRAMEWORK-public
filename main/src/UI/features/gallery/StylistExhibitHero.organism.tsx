// Editorial cover hero for the Stylist Gallery — "entering a curator's studio".
// Avatar + name + business + city/Instagram + one line of numbers, in a white
// box on paper.
// The paired badge stays (pair state); there is no „Portfolio" chip.

import { useTranslations } from 'next-intl';
import {
  CheckCircleIcon,
  InstagramLogoIcon,
  MapPinIcon,
} from '@phosphor-icons/react';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { useIsUnderAppBar } from '../../components/AppHero/appHeroVisibility';
import { ExternalLinkAtom } from '../../components/ExternalLink/ExternalLink.atom';
import styles from './StylistGalleryPage.module.css';

interface StylistExhibitHeroProps {
  displayName: string;
  businessName: string | null;
  city: string | null;
  instagram?: string | null;
  isPaired: boolean;
  totalCount: number;
  uniqueColors: number;
  uniqueStyles: number;
}

export function StylistExhibitHeroOrganism({
  displayName,
  businessName,
  city,
  instagram,
  isPaired,
  totalCount,
  uniqueColors,
  uniqueStyles,
}: StylistExhibitHeroProps) {
  const t = useTranslations('pages.gallery');
  const NameHeading = useIsUnderAppBar() ? 'h2' : 'h1';
  const igHandle = instagram?.replace(/^@/, '') ?? null;
  const showBusinessName =
    Boolean(businessName) && businessName !== displayName;
  // The brand colour tints the whole gallery page through brandScopeProps on its
  // root (see the DECISION in shared/branding/brandScope.module.css).
  return (
    <section className={styles.exhibitHero}>
      <div className={styles.exhibitBody}>
        <div className={styles.exhibitAvatar}>
          <AvatarAtom src={undefined} name={displayName} size='lg' />
        </div>

        <div className={styles.exhibitMeta}>
          <NameHeading className={styles.exhibitName}>
            {displayName}
          </NameHeading>
          {showBusinessName && (
            <p className={styles.exhibitBusinessName}>{businessName}</p>
          )}
          {/* In flow under the name, not absolute in the corner: at 390 px the pill
              overlapped the stylist's name. */}
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
            facts must not look like chips to tap. Each number stays
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

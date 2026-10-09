import { getLocalizedTaxonomyName } from '../../../domain/gallery/gallery-taxonomy.locale';
/* ============================================================
 * PhotoDetailPage.parts — extracted presentational subcomponents
 *
 * Keeps PhotoDetailPage.tsx under the 300-line lint cap while
 * grouping related visuals: hero stage, credit, detail groups, the
 * loading skeleton and the delete dialog (the action rows live in
 * PhotoDetailActions.molecule.tsx). All purely presentational — state
 * & mutations stay in PhotoDetailPage.tsx.
 * ============================================================ */

import { useState } from 'react';
import { AppLinkAtom as Link } from '../../components/AppLink/AppLink.atom';
import { useLocale, useTranslations } from 'next-intl';
import {
  PushPinIcon,
  CalendarBlankIcon,
  RulerIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { usePublicFeatureFlag } from '../../../application/feature-flags/client-feature-flags';
import { ChipAtom, ChipGroupMolecule } from '../../components/Chip/Chip.atom';
import { ColorDotAtom } from '../../components/ColorDot/ColorDot.atom';
import { ImagePlaceholderAtom } from '../../components/ImagePlaceholder/ImagePlaceholder.atom';
import { AvatarAtom } from '../../components/Avatar/Avatar.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { formatDateLong } from '../../../application/date/date.utils';
import { useCurrentLang } from '../../hooks/useCurrentLang';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import type { PhotoDetailData } from '../shared/gallery/hooks/usePhotoDetail';
import { getCloudinaryThumbUrl } from '../../../application/cloudinary/cloudinary-url.utils';
import styles from './PhotoDetailPage.module.css';

/* ============================================================
 * PhotoHeroStage — cinematic image stage with optional pinned ribbon
 * ============================================================ */

interface PhotoHeroStageProps {
  assetUrl: string;
  altText: string;
  isPinned: boolean;
}

export function PhotoHeroStageOrganism({
  assetUrl,
  altText,
  isPinned,
}: PhotoHeroStageProps) {
  /* Pill = wskaźnik STANU (renderuje się tylko gdy praca już przypięta),
   * więc używa galleryCard.pinned ('Przypięte'), NIE trybu rozkazującego
   * pinSimple ('Przypnij') — ten zostaje na przycisku-toggle ownera. */
  const tCard = useTranslations('galleryCard');
  // Fallback gdy obraz NIE załaduje się z CDN (404/timeout) — bez tego zniknięty
  // obiekt Cloudinary daje złamaną ikonkę obrazka na scenie hero.
  const [imgError, setImgError] = useState(false);
  return (
    <section className={styles.hero}>
      <div className={styles.imageFrame}>
        {imgError ? (
          <ImagePlaceholderAtom size='lg' />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- gallery images are user-uploaded to Cloudinary
          <img
            src={getCloudinaryThumbUrl(assetUrl, 800)}
            alt={altText}
            className={styles.image}
            onError={() => setImgError(true)}
          />
        )}
        {isPinned && (
          <div className={styles.pinnedBadge} aria-hidden='true'>
            <PushPinIcon size={12} weight='fill' />
            <span>{tCard('pinned')}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/* ============================================================
 * PhotoCredit — whose work it is (viewers only) + one quiet line of
 * facts: date and nail length. The facts are ALWAYS visible; until
 * S126 they were hidden below 440px, i.e. on every phone.
 * ============================================================ */

interface PhotoCreditProps {
  /** null = the viewer is the owner (the app bar already carries her name). */
  stylistDisplayName: string | null;
  createdAt: string | Date;
  nailLengthLabel: string;
}

export function PhotoCreditMolecule({
  stylistDisplayName,
  createdAt,
  nailLengthLabel,
}: PhotoCreditProps) {
  /* Label nad nazwiskiem = rola osoby ('Stylistka', kanon role.stylist),
   * nie 'Stylizacja' — etykieta opisuje KOGO podpisujemy, nie co jest na
   * zdjęciu (census S26, finding semantyczny). */
  const tRole = useTranslations('role');
  const lang = useCurrentLang();
  return (
    <div className={styles.credit}>
      {stylistDisplayName !== null && (
        <div className={styles.creditPerson}>
          <AvatarAtom src={undefined} name={stylistDisplayName} size='md' />
          <div className={styles.creditMain}>
            <span className={styles.groupLabel}>{tRole('stylist')}</span>
            <span className={styles.creditName}>{stylistDisplayName}</span>
          </div>
        </div>
      )}
      <p className={styles.creditMeta}>
        <span className={styles.creditMetaItem}>
          <CalendarBlankIcon size={16} aria-hidden='true' />
          {formatDateLong(createdAt, lang)}
        </span>
        <span className={styles.creditMetaItem}>
          <RulerIcon size={16} aria-hidden='true' />
          {nailLengthLabel}
        </span>
      </p>
    </div>
  );
}

/* ============================================================
 * PhotoDetailGroups — labeled tags + colors strip
 * ============================================================ */

interface PhotoDetailGroupsProps {
  traits: PhotoDetailData['gallery_record']['traits'];
  colors: PhotoDetailData['gallery_record']['colors'];
}

export function PhotoDetailGroupsMolecule({
  traits,
  colors,
}: PhotoDetailGroupsProps) {
  const locale = useLocale();
  const t = useTranslations('pages.gallery');
  // STYLE_DETAIL ("a style as theme" — all works tagged with this trait across
  // stylists) lives behind EXPLORE_ENABLED (cold-start OFF → route 404s). Make
  // the trait chip a deep-link ONLY when the flag is on, otherwise keep it a
  // static chip — never lead the user into a 404. This is the canonical entry
  // point the feature was built for (docstring: "click Boho -> land here").
  const exploreEnabled = usePublicFeatureFlag(
    FEATURE_FLAG_KEYS.EXPLORE_ENABLED
  );
  if (traits.length === 0 && colors.length === 0) {
    return null;
  }
  return (
    <div className={styles.detailGroups}>
      {traits.length > 0 && (
        <section className={styles.detailGroup}>
          <h2 className={styles.groupLabel}>{t('traits')}</h2>
          <ChipGroupMolecule>
            {traits.map(trait =>
              exploreEnabled ? (
                <Link
                  key={trait.id}
                  href={buildRoute(ROUTES_FRONT.STYLE_DETAIL, { id: trait.id })}
                  className={styles.traitChipLink}>
                  <ChipAtom
                    label={getLocalizedTaxonomyName(trait.name, locale)}
                    size='sm'
                  />
                </Link>
              ) : (
                <ChipAtom
                  key={trait.id}
                  label={getLocalizedTaxonomyName(trait.name, locale)}
                  size='sm'
                />
              )
            )}
          </ChipGroupMolecule>
        </section>
      )}

      {colors.length > 0 && (
        <section className={styles.detailGroup}>
          <h2 className={styles.groupLabel}>{t('colors')}</h2>
          <ul className={styles.colorList}>
            {colors.map(color => (
              <li key={color.id} className={styles.colorItem}>
                <ColorDotAtom color={color.hex_code} size='md' />
                <span>{getLocalizedTaxonomyName(color.name, locale)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ============================================================
 * PhotoDetailSkeleton — the loaded page's geometry: 3:4 photo, the
 * main action, the row of secondary actions, two lines of facts.
 * ============================================================ */

export function PhotoDetailSkeletonMolecule() {
  return (
    <PageColumnsMolecule
      asideSize='wide'
      main={<SkeletonAtom variant='rect' className={styles.skeletonImage} />}
      aside={
        <>
          <div className={styles.actions}>
            <SkeletonAtom variant='rect' className={styles.skeletonAction} />
            <SkeletonAtom variant='rect' className={styles.skeletonAction} />
          </div>
          <div className={styles.credit}>
            <SkeletonAtom variant='text' width={200} />
            <SkeletonAtom variant='text' width={140} />
          </div>
        </>
      }
    />
  );
}

/* ============================================================
 * PhotoDetailDeleteDialog — owner-only delete confirmation dialog
 * ============================================================ */

interface PhotoDetailDeleteDialogProps {
  open: boolean;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PhotoDetailDeleteDialogComposition({
  open,
  isPending,
  onClose,
  onConfirm,
}: PhotoDetailDeleteDialogProps) {
  const t = useTranslations('pages.gallery');
  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen && !isPending) {
          onClose();
        }
      }}
      disablePointerDismissal={isPending}>
      <AppDialogAtom.Content
        title={t('deleteConfirmTitle')}
        closeDisabled={isPending}>
        <AppDialogAtom.Body>
          <TypographyAtom variant='body2'>
            {t('deleteConfirmBody')}
          </TypographyAtom>
        </AppDialogAtom.Body>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={onClose}
            disabled={isPending}>
            {t('deleteConfirmNo')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            icon={<TrashIcon size={16} />}
            onClick={onConfirm}
            disabled={isPending}
            aria-busy={isPending || undefined}>
            {t('deleteConfirmYes')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}

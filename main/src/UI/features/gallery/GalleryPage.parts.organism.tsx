import { memo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LockIcon, PlusIcon } from '@phosphor-icons/react';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { IllustrationAtom } from '../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../assets/lpAssets';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { type QuotaSnapshot } from '../../../application/pricing/quota.helpers';
import { QuotaNoticeMolecule } from '../shared/upsell/QuotaNotice.molecule';
import { QuotaUpgradeDialogOrganism } from '../shared/upsell/QuotaUpgradeDialog.organism';
import styles from './GalleryPage.module.css';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';

/* ============================================================
 * OwnGalleryCardItem — moved from GalleryPage.composition.tsx to keep that
 * file under the eslint max-lines ceiling (300 sloc).
 * ============================================================ */

type OwnGalleryRecord =
  GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE']['records'][number];

interface OwnGalleryCardItemProps {
  record: OwnGalleryRecord;
  isFullWidth: boolean;
  onCardClick: (recordId: string) => void;
}

export const OwnGalleryCardItem = memo(function OwnGalleryCardItem({
  record,
  isFullWidth,
  onCardClick,
}: OwnGalleryCardItemProps) {
  const handleCardClick = () => onCardClick(record.gallery_record_id);

  return (
    <div className={styles.galleryGridItem}>
      <GalleryPhotoCardOrganism
        record={record}
        showHeart={false}
        showPinBadge
        isPinned={record.is_pinned}
        fullWidth={isFullWidth}
        onCardClick={handleCardClick}
      />
    </div>
  );
});

/* ============================================================
 * GalleryHero: intro card (AppHero canon), title + ONE sentence of live
 * numbers. A plan with a photo limit says „4 z 5 prac”, so the limit state
 * lives here, not in a separate progress bar (a fact appears once per screen).
 *
 * DECISION: no stylist name in the title and no middle dot. "Twoja galeria · Ania" painted the name
 * in the action colour (it read as a link) and used "·" as punctuation. The meta is ONE segment
 * with commas: the AppHero primitive draws "·" between adjacent `span` segments, a single segment
 * gets none. (owner)
 * ============================================================ */

interface GalleryHeroProps {
  worksCount: number;
  pinnedCount: number;
  /** Limit zdjęć planu; wartość „bez limitu” daje zdanie bez „z N”. */
  maxPhotos: number;
  currentPlan: PricingPlan;
  /** `loading` rezerwuje wiersz meta, `none` (pusta galeria) go nie ma. */
  metaState: 'ready' | 'loading' | 'none';
}

export function GalleryHeroMolecule({
  worksCount,
  pinnedCount,
  maxPhotos,
  currentPlan,
  metaState,
}: GalleryHeroProps) {
  const t = useTranslations('pages.gallery');
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  const isLimited = !isUnlimitedLimit(maxPhotos) && maxPhotos > 0;
  const plan = getPlanDisplayName(currentPlan);
  return (
    <AppHeroOrganism
      title={t('myTitle')}
      meta={
        metaState === 'none' ? undefined : (
          <span data-breakable=''>
            {metaState === 'loading' ? (
              <SkeletonAtom variant='text' width={220} />
            ) : (
              <span>
                {isLimited
                  ? t.rich('heroMetaSummaryLimited', {
                      works: worksCount,
                      max: maxPhotos,
                      pinned: pinnedCount,
                      plan,
                      b: strong,
                    })
                  : t.rich('heroMetaSummary', {
                      works: worksCount,
                      pinned: pinnedCount,
                      plan,
                      b: strong,
                    })}
              </span>
            )}
          </span>
        )
      }
    />
  );
}

/* ============================================================
 * GallerySkeletonGrid — varied heights for masonry rhythm
 * ============================================================ */

export function GallerySkeletonGridMolecule() {
  return (
    <div className={styles.skeletonGrid} aria-busy='true' aria-live='polite'>
      {Array.from({ length: 8 }, (_, i) => (
        <SkeletonAtom key={i} variant='rect' className={styles.skeletonCard} />
      ))}
    </div>
  );
}

/* ============================================================
 * GalleryEmptyState — branded illustration + inline tip list + CTA
 *
 * Anti-pattern avoided: "0 photos" dry empty state with a sad
 * icon. Instead: warm Notion-style onboarding with framed
 * illustration, three plain-text tips, and a primary CTA.
 *
 * DECISION: see main/src/UI/features/gallery/GalleryPage.module.css (.emptyTips: static tips must
 * not look tappable). The CTA icon is PlusIcon, consistent with the "Dodaj" tab in the tab bar, not
 * Sparkle: adding a photo is a deterministic action, not "magic".
 * ============================================================ */

interface GalleryEmptyStateProps {
  onAddPhoto: () => void;
}

export function GalleryEmptyStateOrganism({
  onAddPhoto,
}: GalleryEmptyStateProps) {
  const t = useTranslations('pages.gallery');
  return (
    <EmptyStateAtom
      size='page'
      className={styles.emptyState}
      illustration={
        <IllustrationAtom src={LP_ASSETS.empty.emptyGallery} size='lg' />
      }
      title={t('emptyTitle')}
      titleAs='h2'
      description={t('emptyHintExtended')}
      action={
        <ButtonAtom
          variant='primary'
          size='lg'
          icon={<PlusIcon size={18} weight='bold' />}
          onClick={onAddPhoto}>
          {t('emptyCtaFirst')}
        </ButtonAtom>
      }>
      <ul className={styles.emptyTips}>
        <li className={styles.emptyTip}>{t('emptyTipPin')}</li>
        <li className={styles.emptyTip}>{t('emptyTipDiverse')}</li>
        <li className={styles.emptyTip}>{t('emptyTipShare')}</li>
      </ul>
    </EmptyStateAtom>
  );
}

interface PlanLimitBannerProps {
  currentPlan: PricingPlan;
  quota: QuotaSnapshot;
}

export function PlanLimitBannerOrganism({
  currentPlan,
  quota,
}: PlanLimitBannerProps) {
  const t = useTranslations('pages.gallery');
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  if (quota.state !== 'one_remaining' && quota.state !== 'exhausted') {
    return null;
  }

  return (
    <>
      {quota.state === 'exhausted' ? (
        <div className={styles.limitNotice}>
          <span className={styles.limitNoticeIcon} aria-hidden='true'>
            <LockIcon size={18} />
          </span>
          <QuotaNoticeMolecule
            feature='gallery'
            quota={quota}
            className={styles.limitNoticeText}
          />
          <ButtonAtom
            variant='primary'
            size='sm'
            className={styles.limitNoticeCta}
            onClick={() => setShowUpgradeDialog(true)}>
            {t('changePlan')}
          </ButtonAtom>
        </div>
      ) : (
        <QuotaNoticeMolecule feature='gallery' quota={quota} />
      )}

      <QuotaUpgradeDialogOrganism
        open={showUpgradeDialog}
        feature='gallery'
        currentPlan={currentPlan}
        onClose={() => setShowUpgradeDialog(false)}
      />
    </>
  );
}

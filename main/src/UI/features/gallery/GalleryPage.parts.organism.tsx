import { memo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useViewTransitionRouter } from '../../layouts/useViewTransitionRouter';
import { LockIcon, PlusIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { UpgradeDialogComposition } from './UpgradeDialog.composition';
import { IllustrationAtom } from '../../components/Illustration/Illustration.atom';
import { LP_ASSETS } from '../../assets/lpAssets';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
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
 * GalleryHero — karta-intro (kanon AppHero): tytuł + JEDNO zdanie żywych
 * liczb. Plan z limitem zdjęć mówi „4 z 5 prac”, więc stan limitu stoi tu,
 * a nie w osobnym pasku z paskiem postępu (S126: fakt raz na ekranie).
 *
 * DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
 * bez imienia stylistki w tytule i bez kropki środkowej. „Twoja galeria ·
 * Ania” malowało imię kolorem akcji (czytało się jak link) i używało „·”
 * jako interpunkcji. Meta to jeden człon z przecinkami: prymityw AppHero
 * rysuje „·” między sąsiednimi członami `span`, jeden człon go nie dostaje.
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
 * DECISION (nie usuwaj): tips render as an inline text list (tonal
 * tint, NO pill border / icon-in-circle). Pill+icon chips read as
 * tappable controls, but these are static guidance (aria-hidden) —
 * fake affordance. Plain list = "to przeczytaj", nie "to kliknij".
 * CTA icon = PlusIcon (spojny z tabem "Dodaj" w tab-barze), nie Sparkle:
 * dodanie zdjecia to deterministyczna akcja, nie "magia".
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
  photoCount: number;
  maxPhotos: number;
}

export function PlanLimitBannerOrganism({
  currentPlan,
  photoCount,
  maxPhotos,
}: PlanLimitBannerProps) {
  const t = useTranslations('pages.gallery');
  const navigate = useViewTransitionRouter();
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const isUnlimited = isUnlimitedLimit(maxPhotos);
  // Guard against divide-by-zero: invalid maxPhotos (0 or negative non-unlimited
  // value) should not render the banner — treat as misconfiguration.
  if (!isUnlimited && maxPhotos <= 0) {
    return null;
  }
  const isAtLimit = !isUnlimited && photoCount >= maxPhotos;
  const isNearLimit = !isUnlimited && !isAtLimit && photoCount >= maxPhotos - 1;
  // Far from the limit the count lives in the hero („4 z 5 prac”); this notice
  // appears only when it asks for a decision: one place left, or none.
  if (isUnlimited || (!isAtLimit && !isNearLimit)) {
    return null;
  }

  return (
    <>
      {isAtLimit ? (
        <div className={styles.limitNotice}>
          <span className={styles.limitNoticeIcon} aria-hidden='true'>
            <LockIcon size={18} />
          </span>
          <p className={styles.limitNoticeText}>{t('planLimitReached')}</p>
          <ButtonAtom
            variant='primary'
            size='sm'
            className={styles.limitNoticeCta}
            onClick={() => setShowUpgradeDialog(true)}>
            {t('changePlan')}
          </ButtonAtom>
        </div>
      ) : (
        <p className={styles.limitHint}>
          {t('planSlotsRemaining', { count: maxPhotos - photoCount })}
        </p>
      )}

      {showUpgradeDialog && (
        <UpgradeDialogComposition
          currentPlan={currentPlan}
          maxPhotos={maxPhotos}
          onClose={() => setShowUpgradeDialog(false)}
          onUpgrade={() => {
            setShowUpgradeDialog(false);
            navigate(ROUTES_FRONT.USER_ACCOUNT_PAY);
          }}
        />
      )}
    </>
  );
}

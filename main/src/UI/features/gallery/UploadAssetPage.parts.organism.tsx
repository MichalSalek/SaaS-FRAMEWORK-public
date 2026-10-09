// UI/features/gallery/UploadAssetPage.parts.tsx
// Status screens only (progress / success / error). Other parts moved into
// `./components/UploadHeader.tsx` and `./components/UploadFormSteps.tsx` to
// respect the 300 LOC per-file ceiling.

import {
  ConfettiIcon,
  PlusIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ProgressAtom } from '../../components/Progress/Progress.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './UploadAssetPage.module.css';
import { TrialOfferCardOrganism } from '../shared/upsell/TrialOfferCard.organism';

/* ============================================================
 *  CROP STEP SKELETON — frame-sized placeholder while the lazy
 *  react-image-crop chunk loads (GAL-10). Reserves the crop-frame
 *  footprint (min-height matching the 3/4 preview) so there's no
 *  layout shift, and reads as a native skeleton — not an empty
 *  void or spinner.
 * ============================================================ */

export function CropStepSkeletonMolecule() {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.cropSkeleton} aria-busy='true' aria-live='polite'>
      <SkeletonAtom variant='rect' className={styles.cropSkeletonFrame} />
      <TypographyAtom
        variant='caption'
        align='center'
        className={styles.cropSkeletonLabel}>
        {t('cropLoadingAlt')}
      </TypographyAtom>
    </div>
  );
}

/* ============================================================
 *  UPLOAD PROGRESS — phase indicator (uploading | saving)
 * ============================================================ */

export function UploadProgressScreenOrganism({
  phase,
}: {
  phase: 'uploading' | 'saving';
}) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.uploadProgress}>
      <div className={styles.uploadProgressHalo} aria-hidden='true' />
      <ProgressAtom size='md' className={styles.uploadProgressBar} />
      <TypographyAtom
        variant='body1'
        align='center'
        className={styles.uploadProgressLabel}>
        {phase === 'uploading'
          ? t('uploadProgressUploading')
          : t('uploadProgressSaving')}
      </TypographyAtom>
    </div>
  );
}

/* ============================================================
 *  SUCCESS — branded confetti icon + sparkle twinkles + dual CTA
 * ============================================================ */

export function UploadSuccessScreenOrganism({
  onAddAnother,
  onGoToGallery,
  photoSrc,
  offerTrial,
}: {
  onAddAnother: () => void;
  onGoToGallery: () => void;
  /** Podglad opublikowanego kadru (null, gdy blob zdazyl zniknac). */
  photoSrc: string | null;
  /** Trzecia praca w galerii: moment oferty Pro (karta sama sprawdza plan). */
  offerTrial: boolean;
}) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.successState}>
      {/* DECISION (nie usuwaj tego komentarza) — pomiar 2026-09-09:
          Ekran sukcesu pokazuje OPUBLIKOWANY KADR, a nie samo konfetti. Powod
          jest dwojaki: (1) dolne ~45% ekranu bylo puste, bo blok nie ma jak sie
          rozciagnac (rodzic `navigation-transition` to blok z `min-height:100%`,
          wiec procentowa wysokosc dziecka rozwiazuje sie do zera — nie da sie go
          wysrodkowac bez ruszania wspoldzielonego layoutu); (2) potwierdzenie
          publikacji, ktore POKAZUJE opublikowana prace, jest mocniejsze niz
          zdanie o niej. Ikona konfetti zostaje wylacznie na wypadek braku
          podgladu. */}
      {photoSrc !== null ? (
        <div className={styles.successPhotoFrame}>
          <Image
            src={photoSrc}
            alt={t('uploadPreviewAlt')}
            width={240}
            height={320}
            className={styles.successPhoto}
            unoptimized
          />
        </div>
      ) : (
        <div className={styles.successIconHalo} aria-hidden='true'>
          <ConfettiIcon size={48} weight='duotone' />
        </div>
      )}
      <TypographyAtom
        variant='h2'
        align='center'
        className={styles.successTitle}>
        {t('uploadSuccess')}
      </TypographyAtom>
      <TypographyAtom
        variant='body1'
        align='center'
        className={styles.successHint}>
        {t('uploadSuccessHint')}
      </TypographyAtom>
      {offerTrial ? (
        <TrialOfferCardOrganism trigger='upload_third_photo' />
      ) : null}
      <div className={styles.successActions}>
        <ButtonAtom
          variant='primary'
          size='lg'
          icon={<PlusIcon size={18} weight='fill' />}
          onClick={onAddAnother}>
          {t('uploadAddAnother')}
        </ButtonAtom>
        {/* Wariant outlined, nie ghost: „Wróć do galerii" było gołym, wyśrodkowanym
            napisem bez żadnej afordancji przycisku. Jedno wypełnione CTA na ekran
            trzyma „Dodaj kolejne", drugorzędne dostaje ramę. */}
        <ButtonAtom variant='outlined' size='md' onClick={onGoToGallery}>
          {t('uploadBackToGallery')}
        </ButtonAtom>
      </div>
    </div>
  );
}

/* ============================================================
 *  ERROR — warm tone (not alarming), retry CTA
 * ============================================================ */

export function UploadErrorScreenOrganism({
  onRetry,
  onBackToSummary,
  isRetrying,
}: {
  /** Publikuje TEN SAM szkic ponownie (plik, kadr i tagi zostają). */
  onRetry: () => void;
  /** Ponowienie w locie: przycisk wyłączony, żeby drugi tap nie dublował rekordu. */
  isRetrying: boolean;
  /** Wraca do kroku 3 z pełnym szkiciem, bez ponownej wysyłki. */
  onBackToSummary: () => void;
}) {
  const t = useTranslations('pages.gallery');
  return (
    <div className={styles.errorState}>
      <div className={styles.errorIconHalo} aria-hidden='true'>
        <WarningCircleIcon size={40} weight='duotone' />
      </div>
      <TypographyAtom variant='h3' align='center'>
        {t('uploadErrorTitle')}
      </TypographyAtom>
      <TypographyAtom variant='body2' align='center'>
        {t('uploadErrorHint')}
      </TypographyAtom>
      <div className={styles.errorActions}>
        <ButtonAtom
          variant='primary'
          size='md'
          onClick={onRetry}
          disabled={isRetrying}
          aria-busy={isRetrying || undefined}>
          {t('uploadRetry')}
        </ButtonAtom>
        <ButtonAtom variant='outlined' size='md' onClick={onBackToSummary}>
          {t('uploadErrorBackToSummary')}
        </ButtonAtom>
      </div>
    </div>
  );
}

// UI/features/gallery/UploadAssetPage.parts.tsx
// Status screens only (progress / success / error). Other parts moved into
// `./components/UploadHeader.tsx` and `./components/UploadFormSteps.tsx` to
// respect the 300 LOC per-file ceiling.

import { PlusIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ProgressAtom } from '../../components/Progress/Progress.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import styles from './UploadAssetPage.module.css';
import { SuccessSceneOrganism } from '../../components/OutcomeFeedback/SuccessScene.organism';
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
    <SuccessSceneOrganism
      presentation='plain'
      actionDock
      title={t('uploadSuccess')}
      body={t('uploadSuccessHint')}
      preview={
        photoSrc ? (
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
        ) : undefined
      }
      actions={
        <>
          <ButtonAtom
            variant='primary'
            size='lg'
            icon={<PlusIcon size={18} weight='fill' />}
            onClick={onAddAnother}>
            {t('uploadAddAnother')}
          </ButtonAtom>
          <ButtonAtom variant='outlined' size='md' onClick={onGoToGallery}>
            {t('uploadBackToGallery')}
          </ButtonAtom>
        </>
      }
      aside={
        offerTrial ? (
          <TrialOfferCardOrganism trigger='upload_third_photo' />
        ) : undefined
      }
    />
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
  /** Publishes the SAME draft again (file, crop and tags stay). */
  onRetry: () => void;
  /** Retry in flight: the button is disabled so a second tap does not duplicate the record. */
  isRetrying: boolean;
  /** Returns to step 3 with the full draft, without resending. */
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

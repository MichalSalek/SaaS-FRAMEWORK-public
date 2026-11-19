// UI/features/gallery/UploadAssetPage.tsx
// Wave 2 portfolio-tier upload flow: shared process header (step indicator,
// title in the app bar), illustrated drop zone with drag-active state,
// sectioned tag form, summary with prominent preview + solid gold CTA,
// success celebration. Plan-limit gate when stylist reaches their plan cap.
//
// Inherits Wave 1 patterns: flat tonal surfaces (color-mix in oklch) + full
// hairline borders, spring easing.
// Reference anchors: Notion file upload (drop zone), Pinterest add board
// (tag chips).

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PencilSimpleIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useFocusedFlow } from '../../layouts/useAppBarTitle.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import {
  UploadProgressScreenOrganism,
  UploadSuccessScreenOrganism,
  UploadErrorScreenOrganism,
  CropStepSkeletonMolecule,
} from './UploadAssetPage.parts.organism';
import {
  UploadPlanLimitGateOrganism,
  PhotoPreviewCardOrganism,
} from './components/UploadHeader.organism';
import { UploadProcessHeaderOrganism } from './components/UploadProcessHeader.organism';
import { UploadSourceZoneMolecule } from './components/UploadSourceZone.molecule';
import { UploadTagStepOrganism } from './components/UploadTagStep.organism';
import { UploadSummaryStepOrganism } from './components/UploadSummaryStep.organism';
import { UploadTipRotatorMolecule } from './components/UploadTipRotator.molecule';
import dynamic from 'next/dynamic';

// DD3-F15 + GAL-10: CropStep is a lazy chunk (react-image-crop). On a slow link
// the chunk download is visible, so we render a frame-sized skeleton (aspect 3/4)
// matching the crop frame footprint — this reserves the layout (no shift) and
// gives a native loading feel, instead of an empty void.
const CropStep = dynamic(
  () =>
    import('./components/CropStep.organism').then(m => ({
      default: m.CropStepOrganism,
    })),
  { ssr: false, loading: () => <CropStepSkeletonMolecule /> }
);
import { FirstPhotoCelebrationOrganism } from './components/FirstPhotoCelebration.organism';
import { MarketingCatchOverlayOrganism } from './components/MarketingCatchOverlay.organism';
import { useUploadAssetState, MAX_COLORS } from './hooks/useUploadAssetState';
import { useMarketingCatch } from './hooks/useMarketingCatch';
import { ACCEPTED_IMAGE_ACCEPT_ATTR } from '../../shared/image/imageUpload.config';
import styles from './UploadAssetPage.module.css';
import { QuotaUpgradeDialogOrganism } from '../shared/upsell/QuotaUpgradeDialog.organism';

function UploadAssetPageInner() {
  const t = useTranslations('pages.gallery');

  const s = useUploadAssetState();
  // From choosing a photo to the end of the wizard it is one process: the bottom
  // navigation leaves and the step's action bar sits on the screen edge (see the
  // DECISION at useFocusedFlow in layouts/useAppBarTitle.composition.tsx).
  useFocusedFlow(s.step > 1 || s.step1Sub === 'crop');

  // GAL-7: one predictable "back" model. The crop slot (step 1, sub 'crop') has
  // two modes: live editor (ReactCrop) vs read-only review (PhotoPreviewCard +
  // "Edytuj kadr"). Selecting/changing a photo opens the editor; pressing "Wstecz"
  // from the tag step lands on the review — never auto-remounts the live editor.
  const [cropEditing, setCropEditing] = useState(true);

  const marketingCatch = useMarketingCatch();
  const marketingOption =
    marketingCatch.eligible || marketingCatch.status !== 'idle' ? (
      <MarketingCatchOverlayOrganism
        isPending={marketingCatch.isPending}
        status={marketingCatch.status}
        onOptIn={() => marketingCatch.optIn(() => undefined)}
        onDismiss={() => marketingCatch.dismiss(() => undefined)}
      />
    ) : undefined;

  // Reset scroll to the top on EVERY wizard stage change (step 1/2/3, substep
  // select/crop, overlay progress/celebration). Without it a stylist scrolled down
  // in step N (e.g. the long „Szczegóły" step) lands MID-step N+1 and does not see
  // the header/stepper. #main-content is the AppLayout scroll container.
  // Canon: auth/hooks/useStepScrollReset.ts (same bug, same fix).
  useEffect(() => {
    const scroller = document.getElementById('main-content');
    if (scroller) {
      scroller.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [s.step, s.step1Sub, s.upload.uploadProgress, s.showCelebration]);

  /* ── In-progress + done + error overlays render in-place of wizard ── */

  if (
    s.upload.uploadProgress === 'uploading' ||
    s.upload.uploadProgress === 'saving'
  ) {
    return <UploadProgressScreenOrganism phase={s.upload.uploadProgress} />;
  }
  if (s.upload.uploadProgress === 'done') {
    // The success scene fills the content shell so its dock can sit on the
    // bottom edge; without this wrapper both success screens returned a bare
    // scene and their actions drifted with the length of the copy. (owner)
    return (
      <div className={styles.resultPage} data-fill-shell=''>
        {s.showCelebration ? (
          <FirstPhotoCelebrationOrganism
            onGoToPairing={() => void s.router.push(ROUTES_FRONT.PAIRING)}
            onAddAnother={s.handleReset}
            onGoToGallery={() => void s.router.push(ROUTES_FRONT.GALLERY)}
            photoSrc={s.croppedPreviewUrl ?? s.previewUrl}
            galleryRecordId={s.upload.data?.gallery_record_id}
            aside={marketingOption}
          />
        ) : (
          <UploadSuccessScreenOrganism
            onAddAnother={s.handleReset}
            onGoToGallery={() => void s.router.push(ROUTES_FRONT.GALLERY)}
            photoSrc={s.croppedPreviewUrl ?? s.previewUrl}
            offerTrial={s.publishedOrdinal !== null && s.publishedOrdinal === 3}
          />
        )}
      </div>
    );
  }
  if (s.upload.uploadProgress === 'error') {
    return (
      <>
        <UploadErrorScreenOrganism
          onRetry={s.handleRetryPublish}
          onBackToSummary={s.handleBackToSummary}
          isRetrying={s.upload.isPending}
        />
        <QuotaUpgradeDialogOrganism
          open={s.quotaUpgradeOpen}
          feature='gallery'
          currentPlan={s.currentPlan}
          onClose={() => s.setQuotaUpgradeOpen(false)}
        />
      </>
    );
  }

  /* ── Plan limit gate ── */
  // DECISION: the plan-limit gate renders BEFORE the wizard (not as a banner inside it) when a
  // stylist hits the plan cap: showing the wizard with a "your upload will fail" banner is
  // dishonest UX. Block early, offer upgrade or back-to-gallery.

  if (s.quota.state === 'exhausted') {
    return (
      <UploadPlanLimitGateOrganism
        currentPlan={s.currentPlan}
        onBackToGallery={() => void s.router.push(ROUTES_FRONT.GALLERY)}
      />
    );
  }

  /* ── Wizard tip — short reassurance line under the step indicator ── */

  // DECISION: the step-2 ribbon states only what step 2 really offers: tags are reversible
  // (PhotoDetailEditModal edits colours, traits and length), which removes the fear of an
  // "irreversible" choice. It used to advise "Opis poprawia SEO i dostępność", but the wizard has
  // no description field (it was scaffolding that was removed), so the advice concerned an
  // impossible action. The ribbon stays for the rhythm of three steps.

  /* ── Main wizard layout ── */

  // `data-fill-shell`: the column takes the content shell's free height, so the
  // action bar of a short step (crop, crop review) stands on the screen edge
  // (rule in layouts/navigation-transition.module.css). Without it the page's
  // `min-height: 100%` resolved against an auto-height shell and the bar sat
  // right under the photo, mid-screen (owner report).
  return (
    <div className={styles.page} data-fill-shell=''>
      <input
        ref={s.fileInputRef}
        type='file'
        accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
        className={styles.hiddenInput}
        onChange={s.handleFileSelect}
      />

      {/* Shared process header: step indicator only, the title is in the
          app bar (DECISION in the component). */}
      <UploadProcessHeaderOrganism currentStep={s.step} />

      {/* Step 1: rotating photo tips (owner). Step 2: the sentence that removes
          the fear of choosing („zmienisz je później”) stands in the step
          description, not in a separate pill above it: a pill looked like a
          button and pushed the colours down 70 px. Step 3: nothing. */}
      {s.step === 1 && <UploadTipRotatorMolecule />}

      {/* Step 1: Select (drop zone) ─────────────────────────── */}
      {s.step === 1 && s.step1Sub === 'select' && (
        <div
          className={`${styles.stepContent} ${styles.stepContentEnter}`}
          style={{ '--stagger-index': 3 } as React.CSSProperties}>
          <UploadSourceZoneMolecule
            dragActive={s.dragActive}
            onBeforePick={() => setCropEditing(true)}
            onPickFromPhone={() => s.fileInputRef.current?.click()}
            onFileSelect={s.handleFileSelect}
            onDragEnter={s.handleDragEnter}
            onDragOver={s.handleDragOver}
            onDragLeave={s.handleDragLeave}
            onDrop={s.handleDrop}
          />
        </div>
      )}

      {/* Step 1.5: Crop — live editor (fresh photo / "Edytuj kadr"). */}
      {s.step === 1 &&
        s.step1Sub === 'crop' &&
        s.previewUrl &&
        s.selectedFile &&
        cropEditing && (
          <CropStep
            previewUrl={s.previewUrl}
            originalFile={s.selectedFile}
            initialCrop={s.cropSelection}
            onCropComplete={(file, crop) => {
              s.handleCropComplete(file, crop);
              setCropEditing(false);
            }}
            onChangePhoto={() => {
              setCropEditing(true);
              s.handleChangePhoto();
            }}
          />
        )}

      {/* Step 1.5: Crop — read-only review (after "Wstecz" from tags).
          GAL-7: shows the framed preview + "Edytuj kadr" / "Dalej" — predictable,
          never auto-opens ReactCrop. */}
      {s.step === 1 &&
        s.step1Sub === 'crop' &&
        s.previewUrl &&
        !cropEditing && (
          /* The action bar is a SIBLING of the step content, not its child;
             see the DECISION at .stickyActionBar (UploadAssetPage.module.css). */
          <>
            <div className={styles.stepContent}>
              <PhotoPreviewCardOrganism
                src={s.croppedPreviewUrl ?? s.previewUrl}
              />
            </div>
            <div className={styles.stickyActionBar}>
              <ButtonAtom
                variant='outlined'
                size='md'
                icon={<PencilSimpleIcon size={16} weight='bold' />}
                onClick={() => setCropEditing(true)}
                className='press-feedback'>
                {t('editPhoto')}
              </ButtonAtom>
              <ButtonAtom
                direction='forward'
                variant='primary'
                size='md'
                onClick={() => s.setStep(2)}
                className={`${styles.stickyPrimaryCta} press-feedback`}>
                {t('uploadNext')}
              </ButtonAtom>
            </div>
          </>
        )}

      {/* Step 2+3: photo preview card stays above the form. */}
      {s.previewUrl && s.step >= 2 && (
        <PhotoPreviewCardOrganism
          src={s.croppedPreviewUrl ?? s.previewUrl}
          size='compact'
        />
      )}

      {/* Step 2 ─────────────────────────────────────────────── */}
      {s.step === 2 && (
        <UploadTagStepOrganism
          colors={s.colors}
          traits={s.traits}
          colorsStatus={{
            isLoading: s.colorsQuery.isLoading,
            isError: s.colorsQuery.isError,
            onRetry: () => void s.colorsQuery.refetch(),
            isRetrying: s.colorsQuery.isFetching,
          }}
          traitsStatus={{
            isLoading: s.traitsQuery.isLoading,
            isError: s.traitsQuery.isError,
            onRetry: () => void s.traitsQuery.refetch(),
            isRetrying: s.traitsQuery.isFetching,
          }}
          selectedColorIds={s.selectedColorIds}
          selectedTraitIds={s.selectedTraitIds}
          selectedLength={s.selectedLength}
          nailLengthOptions={
            s.nailLengthOptions as readonly { id: NailLength; label: string }[]
          }
          maxColors={MAX_COLORS}
          onToggleColor={s.toggleColor}
          onToggleTrait={s.toggleTrait}
          onSelectLength={s.setSelectedLength}
          onBack={() => {
            // GAL-7: land on the read-only crop review, not the live editor.
            setCropEditing(false);
            s.setStep(1);
            s.setStep1Sub('crop');
          }}
          onNext={() => s.setStep(3)}
          canProceed={s.canProceedStep2}
          blockedReason={s.step2BlockedReason}
        />
      )}

      {/* Step 3 ─────────────────────────────────────────────── */}
      {s.step === 3 && (
        <UploadSummaryStepOrganism
          selectedColors={s.selectedColorObjects}
          selectedTraits={s.selectedTraitObjects}
          selectedLength={s.selectedLength}
          nailLengthOptions={
            s.nailLengthOptions as readonly { id: NailLength; label: string }[]
          }
          onBack={() => s.setStep(2)}
          onPublish={() => void s.handlePublish()}
          quota={s.quota}
          isPublishing={s.upload.isPending}
        />
      )}
    </div>
  );
}

export function UploadAssetPageComposition() {
  const t = useTranslations('pages.gallery');
  return (
    <AppLayoutComposition title={t('uploadTitle')}>
      <UploadAssetPageInner />
    </AppLayoutComposition>
  );
}

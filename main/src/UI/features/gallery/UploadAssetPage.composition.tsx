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

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CloudArrowUpIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useFocusedFlow } from '../../layouts/useAppBarTitle.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
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

function UploadAssetPageInner() {
  const t = useTranslations('pages.gallery');

  const s = useUploadAssetState();
  // Od wybrania zdjęcia do końca kreatora to jeden proces: dolna nawigacja
  // schodzi, belka akcji kroku siada na krawędzi ekranu (DECISION w hooku).
  useFocusedFlow(s.step > 1 || s.step1Sub === 'crop');

  // GAL-7: one predictable "back" model. The crop slot (step 1, sub 'crop') has
  // two modes: live editor (ReactCrop) vs read-only review (PhotoPreviewCard +
  // "Edytuj kadr"). Selecting/changing a photo opens the editor; pressing "Wstecz"
  // from the tag step lands on the review — never auto-remounts the live editor.
  const [cropEditing, setCropEditing] = useState(true);

  // Faza 2 zgody marketingowej: po PIERWSZYM zdjęciu, jeśli stylistka pominęła
  // opt-in w onboardingu, łapiemy zgodę pełnoekranowym promptem. Przechwytujemy
  // KAŻDE CTA celebracji: celebration -> catch -> pierwotna nawigacja. Hooki +
  // stan MUSZĄ być przed warunkowymi returnami (Rules of Hooks).
  const marketingCatch = useMarketingCatch();
  const [catchOpen, setCatchOpen] = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);

  const withCatch = (proceed: () => void) => () => {
    if (marketingCatch.eligible && !catchOpen) {
      pendingNavRef.current = proceed;
      setCatchOpen(true);
    } else {
      proceed();
    }
  };

  const runPendingNav = () => {
    const next = pendingNavRef.current;
    pendingNavRef.current = null;
    setCatchOpen(false);
    next?.();
  };

  // Flow-pass §5b (S33): reset scrolla na top przy KAŻDEJ zmianie etapu wizarda
  // (krok 1/2/3, substep select/crop, overlay progress/celebration). Bez tego
  // stylistka przewinięta w kroku N (np. na dole długiego kroku „Szczegóły")
  // ląduje w POŁOWIE kroku N+1 — nie widzi nagłówka/steppera (DOM-probe: step2
  // dół 1584 → step3 791/1595). #main-content = scroll-kontener AppLayout.
  // Kanon: auth/hooks/useStepScrollReset.ts (ten sam bug naprawiony flow-passem S32).
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
    if (s.showCelebration) {
      // Catch zastępuje celebrację po kliknięciu CTA (content-swap, bez stackowania
      // overlayów). Po opt-in/dismiss runPendingNav wykonuje pierwotną nawigację.
      if (catchOpen) {
        return (
          <MarketingCatchOverlayOrganism
            isPending={marketingCatch.isPending}
            onOptIn={() => marketingCatch.optIn(runPendingNav)}
            onDismiss={() => marketingCatch.dismiss(runPendingNav)}
          />
        );
      }
      return (
        <FirstPhotoCelebrationOrganism
          onGoToPairing={withCatch(
            () => void s.router.push(ROUTES_FRONT.PAIRING)
          )}
          onAddAnother={withCatch(s.handleReset)}
          onGoToGallery={withCatch(
            () => void s.router.push(ROUTES_FRONT.GALLERY)
          )}
        />
      );
    }
    return (
      <UploadSuccessScreenOrganism
        onAddAnother={s.handleReset}
        onGoToGallery={() => void s.router.push(ROUTES_FRONT.GALLERY)}
        photoSrc={s.croppedPreviewUrl ?? s.previewUrl}
        offerTrial={s.publishedOrdinal !== null && s.publishedOrdinal >= 3}
      />
    );
  }
  if (s.upload.uploadProgress === 'error') {
    return (
      <UploadErrorScreenOrganism
        onRetry={s.handleRetryPublish}
        onBackToSummary={s.handleBackToSummary}
        isRetrying={s.upload.isPending}
      />
    );
  }

  /* ── Plan limit gate ── */
  // DECISION (nie usuwaj tego komentarza):
  // The gate renders BEFORE the wizard (not as a banner inside it) when a stylist
  // hits their plan cap. Reasoning: showing the wizard with a "your upload will
  // fail" banner is dishonest UX. Block early, offer upgrade or back-to-gallery.

  if (s.planLimitReached) {
    return (
      <UploadPlanLimitGateOrganism
        currentPlan={s.currentPlan}
        photoCount={s.photoCount}
        maxPhotos={s.maxPhotos}
        onUpgrade={() => void s.router.push(ROUTES_FRONT.USER_ACCOUNT_PAY)}
        onBackToGallery={() => void s.router.push(ROUTES_FRONT.GALLERY)}
      />
    );
  }

  /* ── Wizard tip — short reassurance line under the step indicator ── */

  // DECISION (nie usuwaj tego komentarza) — pomiar 2026-09-09:
  // Wstążka kroku 2 mówiła „Opis poprawia SEO i dostępność", a w kreatorze nie
  // ma ani jednego <textarea> (pole opisu było rusztowaniem, skasowanym
  // 2026-09-11 — patrz DECISION w useUploadAssetState). Rada dotyczyła więc
  // czynności niewykonalnej. Wstążka nie znika (rytm trzech kroków), tylko mówi
  // prawdę o tym, co krok 2 realnie oferuje: tagi są odwracalne
  // (PhotoDetailEditModal edytuje kolory, cechy i długość), więc zdejmujemy lęk
  // przed „nieodwracalnym" wyborem. Klucz `uploadTipDescription` USUNIĘTY
  // z trzech locale.

  /* ── Main wizard layout ── */

  return (
    <div className={styles.page}>
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

      {/* Krok 1: rotujące wskazówki o zdjęciu (owner 2026-10-08). Krok 2:
          zdanie zdejmujące lęk przed wyborem („zmienisz je później”) stoi
          w opisie kroku, nie w osobnej pigułce nad nim: pigułka wyglądała na
          przycisk i odsuwała kolory o kolejne 70 px. Krok 3: nic. */}
      {s.step === 1 && <UploadTipRotatorMolecule />}

      {/* Step 1: Select (drop zone) ─────────────────────────── */}
      {s.step === 1 && s.step1Sub === 'select' && (
        <div
          className={`${styles.stepContent} ${styles.stepContentEnter}`}
          style={{ '--stagger-index': 3 } as React.CSSProperties}>
          <button
            type='button'
            className={`${styles.dropzone} haptic-press ${s.dragActive ? styles.dropzoneActive : ''}`}
            onClick={() => {
              setCropEditing(true);
              s.fileInputRef.current?.click();
            }}
            onDragEnter={s.handleDragEnter}
            onDragOver={s.handleDragOver}
            onDragLeave={s.handleDragLeave}
            onDrop={s.handleDrop}
            aria-label={t('uploadDropzoneTitle')}>
            <div className={styles.dropzoneIconHalo} aria-hidden='true'>
              <CloudArrowUpIcon size={36} weight='duotone' />
            </div>
            {/* Serif h4 — nagłówki w kartach są display-serif w całej apce
                (sans czytał się jak filler systemowy, fresh-eyes S25);
                h4 trzyma dystans skali do H1 hero. */}
            <TypographyAtom
              variant='h4'
              align='center'
              className={styles.dropzoneTitle}>
              {s.dragActive
                ? t('uploadDropzoneDragActive')
                : t('uploadDropzoneTitle')}
            </TypographyAtom>
            <TypographyAtom
              variant='body2'
              align='center'
              className={styles.dropzoneSubtitle}>
              {t('uploadDropzoneSubtitle')}
            </TypographyAtom>
            {/* Bez ikony: dekoracja na pillu specyfikacji plików = szum
                dekoracyjny (fresh-eyes S25). */}
            <span className={styles.dropzoneFormats}>
              {t('uploadDropzoneFormats')}
            </span>
          </button>
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
          /* Listwa akcji jest RODZEŃSTWEM treści kroku, nie jej dzieckiem —
             powód w DECISION przy .stickyActionBar (UploadAssetPage.module.css). */
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
                className='haptic-press'>
                {t('editPhoto')}
              </ButtonAtom>
              <ButtonAtom
                direction='forward'
                variant='primary'
                size='md'
                onClick={() => s.setStep(2)}
                className={`${styles.stickyPrimaryCta} haptic-press`}>
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

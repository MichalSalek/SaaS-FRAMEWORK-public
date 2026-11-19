import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import type { Crop } from 'react-image-crop';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { resolveQuotaSnapshot } from '../../../../application/pricing/quota.helpers';
import { useNailLengthOptions } from '../../shared/gallery/nailLengthOptions.config';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { useGalleryColors } from '../../shared/gallery/hooks/useGalleryColors';
import { useGalleryTraits } from '../../shared/gallery/hooks/useGalleryTraits';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import {
  useUploadGalleryRecord,
  type UploadGalleryPayload,
} from './useUploadGalleryRecord';
import { useUsageStats } from '../../shared/account/hooks/useUsageStats';
import {
  firstPhotoOutcomeKey,
  isUploadQuotaLimitError,
  isFirstPhotoOutcomeEligible,
  markFirstPhotoOutcome,
} from './useUploadAssetState.rules';
import { toggleCappedSelection, toggleSelection } from './tagSelection';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { useSingleFlight } from './useSingleFlight';
import { hapticNotification } from '../../../../application/platform/haptics';
import { useUploadFlowTrace } from './useUploadFlowTrace';
import { useUploadDraftMemory } from './useUploadDraftMemory';
import { useUploadFileSelection } from './useUploadFileSelection';
import type { UploadDraftSnapshot } from './uploadDraftMemory';
import { GalleryUploadIdentityChanged } from './gallery-upload-identity';

export type Step = 1 | 2 | 3;
export type Step1Sub = 'select' | 'crop';

export const MAX_COLORS = 3;
// DECISION: the "Opis stylizacji" field (state, molecule, GALLERY_DESCRIPTION_PERSISTED flag,
// MIN_DESCRIPTION_LENGTH, i18n keys) was REMOVED. It was scaffolding: there is no
// GalleryRecord.description column and the publish payload never carried it, so the field lived
// only behind a disabled flag. If a description ever returns, it returns WHOLE and deliberately:
// schema column, upload payload, kernel validation, then a display surface (alt/SEO on the photo
// detail). Do not restore it as a hidden field behind a flag. (owner)

export function useUploadAssetState() {
  const t = useTranslations('pages.gallery');
  const nailLengthOptions = useNailLengthOptions();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const colorsQuery = useGalleryColors();
  const traitsQuery = useGalleryTraits();
  const { colors } = colorsQuery;
  const { traits } = traitsQuery;
  const upload = useUploadGalleryRecord();
  const { data: usage } = useUsageStats();
  const { data: currentUser } = useCurrentUserAccount();

  const [step, setStep] = useState<Step>(1);
  const [step1Sub, setStep1Sub] = useState<Step1Sub>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // DECISION: the preview after cropping MUST show the cropped file, not the original. All preview
  // surfaces (review card, steps 2 and 3) used to render `previewUrl`, the ORIGINAL, which CSS cut
  // to 3:4 centred, so "approve crop" looked like it did nothing. The crop editor still gets the
  // ORIGINAL (cropping always starts from the full photo, not from the previous cut). (owner
  // 2026-09-09)
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(
    null
  );
  // Remembered crop rectangle: returning to the editor („Edytuj kadr") resumes the
  // stylist's SELECTION instead of resetting it to a centred 90% width.
  const [cropSelection, setCropSelection] = useState<Crop | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedTraitIds, setSelectedTraitIds] = useState<string[]>([]);
  const [selectedLength, setSelectedLength] = useState<NailLength | null>(null);

  const photoCount = usage?.gallery_records;
  const currentPlan = getEffectivePricingPlan(currentUser?.stylist_account);
  const quota = resolveQuotaSnapshot(
    usage?.gallery_records,
    usage?.limits.max_gallery_records
  );
  const [quotaUpgradeOpen, setQuotaUpgradeOpen] = useState(false);

  const [showCelebration, setShowCelebration] = useState(false);
  // Which piece in the gallery the last publish was (1-based), snapshotted
  // BEFORE the mutation like wasFirstUpload; null = gallery not loaded yet.
  // Drives the trial offer after the 3rd piece (free-first entry, owner
  // 2026-09-23, DOMAIN_SSOT §18).
  const [publishedOrdinal, setPublishedOrdinal] = useState<number | null>(null);
  // Named analytics steps of this wizard (flow `upload`); facts only.
  const trace = useUploadFlowTrace(step, selectedFile, croppedFile, upload);

  const resetLocalDraft = useCallback(() => {
    setStep(1);
    setStep1Sub('select');
    setSelectedFile(null);
    setCroppedFile(null);
    setPreviewUrl(null);
    setCroppedPreviewUrl(null);
    setCropSelection(null);
    setSelectedColorIds([]);
    setSelectedTraitIds([]);
    setSelectedLength(null);
    setDragActive(false);
    setShowCelebration(false);
    setPublishedOrdinal(null);
    setQuotaUpgradeOpen(false);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = '';
    }
  }, []);

  const restoreDraft = useCallback((saved: UploadDraftSnapshot) => {
    setStep(saved.step);
    setStep1Sub(saved.step1Sub);
    setSelectedFile(saved.originalFile);
    setCroppedFile(saved.croppedFile);
    setPreviewUrl(URL.createObjectURL(saved.originalFile));
    setCroppedPreviewUrl(
      saved.croppedFile === null ? null : URL.createObjectURL(saved.croppedFile)
    );
    setCropSelection(saved.cropSelection);
    setSelectedColorIds(saved.selectedColorIds);
    setSelectedTraitIds(saved.selectedTraitIds);
    setSelectedLength(saved.selectedLength);
  }, []);

  const uploadDraftSnapshot = useMemo<UploadDraftSnapshot | null>(
    () =>
      selectedFile === null
        ? null
        : {
            step,
            step1Sub,
            originalFile: selectedFile,
            croppedFile,
            cropSelection,
            selectedColorIds,
            selectedTraitIds,
            selectedLength,
          },
    [
      step,
      step1Sub,
      selectedFile,
      croppedFile,
      cropSelection,
      selectedColorIds,
      selectedTraitIds,
      selectedLength,
    ]
  );
  const draftMemory = useUploadDraftMemory({
    userId: currentUser?.id,
    snapshot: uploadDraftSnapshot,
    resetDraft: resetLocalDraft,
    restoreDraft,
  });
  const fileSelection = useUploadFileSelection({
    fileInputRef,
    previewUrl,
    croppedPreviewUrl,
    setStep,
    setStep1Sub,
    setSelectedFile,
    setCroppedFile,
    setPreviewUrl,
    setCroppedPreviewUrl,
    setCropSelection,
    setDragActive,
    onChangePhoto: draftMemory.clear,
  });

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (croppedPreviewUrl) {
        URL.revokeObjectURL(croppedPreviewUrl);
      }
    };
  }, [croppedPreviewUrl]);

  // Steps 2 and 3 carry the prepared work (crop, colors, traits, length) in
  // local state only: leaving by the tab bar, back or reload asks first.
  useLeaveGuard({
    when: step >= 2 && upload.uploadProgress !== 'done',
    message: t('uploadLeaveWarning'),
  });

  // DECISION: the step-2 gate and ITS JUSTIFICATION are computed in one place: `canProceed` is
  // DERIVED from the list of what is missing, not a second copy of the same three conditions.
  // Before, the rule lived here and the UI said nothing about it: the section was captioned "Kolory
  // (max 3)" with a "0/3" counter, so a disabled "Dalej" looked like a failure (measured: 1 trait +
  // 1 length gave a disabled button and no message in the DOM). Adding a reason is now impossible
  // to skip: every new condition enters through the same array.
  const missingStep2Fields = useMemo(() => {
    const missing: string[] = [];
    if (selectedColorIds.length === 0) {
      missing.push(t('uploadNextBlockedColors'));
    }
    if (selectedTraitIds.length === 0) {
      missing.push(t('uploadNextBlockedTraits'));
    }
    if (selectedLength === null) {
      missing.push(t('uploadNextBlockedLength'));
    }
    return missing;
  }, [t, selectedColorIds.length, selectedTraitIds.length, selectedLength]);
  const canProceedStep2 = missingStep2Fields.length === 0;
  const step2BlockedReason = canProceedStep2
    ? null
    : t('uploadNextBlocked', { missing: missingStep2Fields.join(', ') });

  const toggleColor = (colorId: string) => {
    setSelectedColorIds(prev =>
      toggleCappedSelection(prev, colorId, MAX_COLORS)
    );
  };

  const toggleTrait = (traitId: string) => {
    setSelectedTraitIds(prev => toggleSelection(prev, traitId));
  };

  // Single-flight: a double tap on publish or on the error screen's retry
  // started two mutations and created TWO gallery records.
  const handlePublish = useSingleFlight(async () => {
    const fileToUpload = croppedFile ?? selectedFile;
    if (!fileToUpload || !selectedLength) {
      return;
    }
    const payload: UploadGalleryPayload = {
      file: fileToUpload,
      color_ids: selectedColorIds,
      trait_ids: selectedTraitIds,
      nail_length: selectedLength,
    };
    // DECISION: the account-scoped activation namespace stores this separate
    // high-water latch; deleting all photos or revisiting never repeats first success.
    const firstPhotoKey = firstPhotoOutcomeKey(currentUser?.id ?? null);
    const wasFirstUpload = isFirstPhotoOutcomeEligible(
      usage?.gallery_records,
      currentUser?.id ?? null,
      firstPhotoKey
    );
    setPublishedOrdinal(photoCount !== undefined ? photoCount + 1 : null);
    try {
      const uploaded = await trace.publish(payload);
      if (!uploaded.isCurrent()) {
        return;
      }
      draftMemory.markSuccessful();
      // The success vibration belongs to the server's confirmation
      // (GALLERY_RECORD_CREATED in `platform/haptic-events.config.ts`), so it
      // lands together with the success screen or the first-photo celebration
      // and is not repeated here.
      if (wasFirstUpload && firstPhotoKey) {
        setShowCelebration(markFirstPhotoOutcome(firstPhotoKey));
      }
      // DECISION: ZERO snackbar on success. After publishing, the whole screen turns into
      // UploadSuccessScreen (or FirstPhotoCelebration) whose H1 reads EXACTLY like the toast text
      // (`uploadSuccess`), so the toast covered its own heading with the same sentence. The screen
      // is the confirmation; the toast stays only for an ERROR (the catch below), where no screen
      // carries the message.
    } catch (e) {
      if (e instanceof GalleryUploadIdentityChanged) {
        return;
      }
      setQuotaUpgradeOpen(isUploadQuotaLimitError(e));
      // One error vibration on either-step failure; the stylist may be away from her phone.
      void hapticNotification('Error');
      // Two-step upload: Step 1 (Cloudinary raw fetch) bypasses the HTTP
      // interceptor, so its failure needs THIS toast. Step 2 (createGalleryRecord_IO)
      // goes through the interceptor, which already toasts the backend gallery event
      // (e.g. GALLERY_LIMIT_REACHED) or INTERNET_CONNECTION_PROBLEM — a second push
      // here would stack a duplicate. Guard: only toast for a non-IO (Step 1) throw.
      if (!isIOError(e)) {
        pushNewSnackbar(t('uploadFailed'), 'error');
      }
    }
  });

  // DECISION: a publish error does NOT erase the prepared work. The error screen used to call
  // `handleReset`, which zeroed file, crop, colours, traits and length, so a brief network loss
  // cost the stylist the whole preparation. Retry publishes the SAME draft again; "back to summary"
  // clears only the mutation state (step 3 with the full draft). `handleReset` stays only for the
  // deliberate "add another" after success.
  const handleRetryPublish = () => void handlePublish();
  const handleBackToSummary = () => upload.reset();

  const handleReset = () => {
    draftMemory.clear();
    resetLocalDraft();
    upload.reset();
  };

  const selectedColorObjects = colors.filter(c =>
    selectedColorIds.includes(c.id)
  );
  const selectedTraitObjects = traits.filter(t =>
    selectedTraitIds.includes(t.id)
  );

  return {
    router,
    nailLengthOptions,
    fileInputRef,
    colors,
    traits,
    colorsQuery,
    traitsQuery,
    upload,
    step,
    setStep,
    step1Sub,
    setStep1Sub,
    selectedFile,
    previewUrl,
    croppedPreviewUrl,
    cropSelection,
    dragActive,
    selectedColorIds,
    selectedTraitIds,
    selectedLength,
    setSelectedLength,
    showCelebration,
    publishedOrdinal,
    canProceedStep2,
    step2BlockedReason,
    selectedColorObjects,
    selectedTraitObjects,
    currentPlan,
    quota,
    quotaUpgradeOpen,
    setQuotaUpgradeOpen,
    handleFileSelect: trace.fromInput(fileSelection.handleFileSelect),
    handleDragEnter: fileSelection.handleDragEnter,
    handleDragOver: fileSelection.handleDragOver,
    handleDragLeave: fileSelection.handleDragLeave,
    handleDrop: trace.fromDrop(fileSelection.handleDrop),
    handleCropComplete: fileSelection.handleCropComplete,
    handleChangePhoto: fileSelection.handleChangePhoto,
    toggleColor,
    toggleTrait,
    handlePublish,
    handleRetryPublish: trace.retrying(handleRetryPublish),
    handleBackToSummary,
    handleReset,
  };
}

import type { ChangeEvent, DragEvent, RefObject } from 'react';
import type { Crop } from 'react-image-crop';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isAcceptedImageMimeType } from '../../../shared/image/imageUpload.config';

type Step = 1 | 2 | 3;
type Step1Sub = 'select' | 'crop';

// Input ceiling of the work-upload wizard. DELIBERATELY higher than the 8 MB avatar limit
// (StylistAvatarField): there the file is cropped to a square and recompressed, here a 3:4
// frame is cut from the full photo. The same number exists in the kernel as
// HTTP_CLIENT_CONFIG.MAX_CONTENT_LENGTH_BYTES, but that is a COINCIDENCE: that constant
// describes the backend HTTP client, while this upload goes direct-to-Cloudinary. Do not
// derive one from the other.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

interface UseUploadFileSelectionOptions {
  fileInputRef: RefObject<HTMLInputElement | null>;
  previewUrl: string | null;
  croppedPreviewUrl: string | null;
  setStep: (step: Step) => void;
  setStep1Sub: (substep: Step1Sub) => void;
  setSelectedFile: (file: File | null) => void;
  setCroppedFile: (file: File | null) => void;
  setPreviewUrl: (url: string | null) => void;
  setCroppedPreviewUrl: (url: string | null) => void;
  setCropSelection: (crop: Crop | null) => void;
  setDragActive: (active: boolean) => void;
  onChangePhoto: () => void;
}

export function useUploadFileSelection({
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
  onChangePhoto,
}: UseUploadFileSelectionOptions) {
  const t = useTranslations('pages.gallery');

  const processFile = (file: File | undefined | null) => {
    if (!file) {
      return;
    }
    if (!isAcceptedImageMimeType(file.type)) {
      pushNewSnackbar(t('uploadInvalidFileType'), 'error');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      pushNewSnackbar(t('uploadFileTooLarge'), 'error');
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setCroppedPreviewUrl(null);
    setCropSelection(null);
    setStep1Sub('crop');
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    processFile(event.target.files?.[0]);
  };

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes('Files')) {
      setDragActive(true);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes('Files')) {
      event.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    // Only deactivate when leaving the dropzone shell (not nested children).
    if (event.currentTarget === event.target) {
      setDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    processFile(event.dataTransfer.files?.[0]);
  };

  const handleCropComplete = (file: File, crop: Crop) => {
    setCroppedFile(file);
    setCropSelection(crop);
    // DECISION: `createObjectURL` is called OUTSIDE the functional state updater. Dev StrictMode
    // calls updaters TWICE, so a side effect inside created two blob URLs, of which only the second
    // reached state; the first was left with no owner and no chance of `revokeObjectURL`. The same
    // pattern is described in features/explore/hooks/useGalleryFilters.ts.
    if (croppedPreviewUrl) {
      URL.revokeObjectURL(croppedPreviewUrl);
    }
    setCroppedPreviewUrl(URL.createObjectURL(file));
    setStep(2);
  };

  const handleChangePhoto = () => {
    onChangePhoto();
    setSelectedFile(null);
    setCroppedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    if (croppedPreviewUrl) {
      URL.revokeObjectURL(croppedPreviewUrl);
    }
    setCroppedPreviewUrl(null);
    setCropSelection(null);
    setStep1Sub('select');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return {
    handleFileSelect,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleCropComplete,
    handleChangePhoto,
  };
}

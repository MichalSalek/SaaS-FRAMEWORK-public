import {
  useRef,
  useState,
  useEffect,
  useMemo,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import type { Crop } from 'react-image-crop';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { isUnlimitedLimit } from '@kernel/policies/pricing.policy';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { useNailLengthOptions } from '../../shared/gallery/nailLengthOptions.config';
import { hapticNotification } from '../../../../application/platform/haptics';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { useGalleryColors } from '../../shared/gallery/hooks/useGalleryColors';
import { useGalleryTraits } from '../../shared/gallery/hooks/useGalleryTraits';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import {
  useUploadGalleryRecord,
  type UploadGalleryPayload,
} from './useUploadGalleryRecord';
import {
  useOwnGallery,
  flattenGalleryPages,
} from '../../shared/gallery/hooks/useOwnGallery';
import { isAcceptedImageMimeType } from '../../../shared/image/imageUpload.config';
import { toggleCappedSelection, toggleSelection } from './tagSelection';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { useSingleFlight } from './useSingleFlight';

export type Step = 1 | 2 | 3;
export type Step1Sub = 'select' | 'crop';

export const MAX_COLORS = 3;
// Sufit wejściowy kreatora stylizacji. CELOWO wyższy niż 8 MB avatara
// (StylistAvatarField): tam plik i tak schodzi po kadrze do kwadratu i
// rekompresji, tutaj wrzucany jest kadr 3:4 z pełnego zdjęcia. Ta sama liczba
// stoi w jądrze jako HTTP_CLIENT_CONFIG.MAX_CONTENT_LENGTH_BYTES, ale to
// ZBIEG OKOLICZNOŚCI: tamta stała opisuje klienta HTTP backendu (i dziś nie ma
// nawet czytelnika), a upload idzie direct-to-Cloudinary. Nie ma między nimi
// zależności do wyprowadzenia — nie wiąż ich.
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
// DECISION (nie usuwaj tego komentarza) — decyzja ownera 2026-09-11:
// Pole „Opis stylizacji" (stan, molekuła, flaga GALLERY_DESCRIPTION_PERSISTED,
// MIN_DESCRIPTION_LENGTH, klucze i18n) USUNIĘTE. Było rusztowaniem: nie ma
// kolumny GalleryRecord.description, payload publikacji nigdy jej nie niósł,
// więc pole żyło wyłącznie za wyłączoną flagą. Gdyby opis miał wrócić, wraca
// CAŁY i świadomie: kolumna w schemacie → payload uploadu → walidacja w jądrze
// → powierzchnia wyświetlania (alt/SEO na szczególe zdjęcia). Nie przywracaj go
// jako ukrytego pola za flagą.

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
  const { data: galleryRecords } = useOwnGallery();
  const { data: currentUser } = useCurrentUserAccount();

  const [step, setStep] = useState<Step>(1);
  const [step1Sub, setStep1Sub] = useState<Step1Sub>('select');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [croppedFile, setCroppedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
  // Podgląd po kadrowaniu MUSI pokazywać plik po kadrze, nie oryginał. Wcześniej
  // wszystkie powierzchnie podglądu (karta review, kroki 2 i 3) renderowały
  // `previewUrl`, czyli ORYGINAŁ, a CSS docinał go do 3:4 po środku — więc
  // „zatwierdź kadr" wyglądało jak brak efektu: „kadrowanie jest i tak
  // wycentrowane domyślnie". Edytor kadru dostaje dalej ORYGINAŁ (kadruje się
  // zawsze od pełnego zdjęcia, nie od poprzedniego wycinka).
  const [croppedPreviewUrl, setCroppedPreviewUrl] = useState<string | null>(
    null
  );
  // Zapamiętany prostokąt kadru: powrót do edytora („Edytuj kadr") wznawia
  // WYBÓR stylistki zamiast resetować go do wycentrowanych 90% szerokości.
  const [cropSelection, setCropSelection] = useState<Crop | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedColorIds, setSelectedColorIds] = useState<string[]>([]);
  const [selectedTraitIds, setSelectedTraitIds] = useState<string[]>([]);
  const [selectedLength, setSelectedLength] = useState<NailLength | null>(null);

  const galleryRecordsFlat = useMemo(
    () => flattenGalleryPages(galleryRecords),
    [galleryRecords]
  );
  const photoCount = galleryRecordsFlat.length;
  const isFirstUpload = photoCount === 0;
  const currentPlan =
    currentUser?.stylist_account?.pricing_plan ?? PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(currentPlan);
  const maxPhotos = planConfig.max_gallery_records;
  const planLimitReached =
    !isUnlimitedLimit(maxPhotos) && photoCount >= maxPhotos;

  const [showCelebration, setShowCelebration] = useState(false);
  // Which piece in the gallery the last publish was (1-based), snapshotted
  // BEFORE the mutation like wasFirstUpload; null = gallery not loaded yet.
  // Drives the trial offer after the 3rd piece (free-first entry, owner
  // 2026-09-23, DOMAIN_SSOT §18).
  const [publishedOrdinal, setPublishedOrdinal] = useState<number | null>(null);

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

  const progressValue = (step / 3) * 100;
  // DECISION (nie usuwaj tego komentarza) — pomiar 2026-09-09:
  // Bramka kroku 2 i JEJ UZASADNIENIE liczą się w jednym miejscu: `canProceed`
  // jest POCHODNĄ listy braków, nie drugą kopią tych samych trzech warunków.
  // Wcześniej reguła żyła tu, a interfejs nie mówił o niej nic — sekcja nosiła
  // podpis „Kolory (max 3)" i licznik „0/3 wybranych", więc wyłączone „Dalej"
  // wyglądało jak awaria (zmierzone: 1 cecha + 1 długość → button disabled,
  // zero komunikatu w DOM). Dopisanie powodu do listy braków jest odtąd
  // niemożliwe do pominięcia: każdy nowy warunek wchodzi tą samą tablicą.
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

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    processFile(e.target.files?.[0]);
  };

  /* -- Drag and drop handlers for the dropzone -- */

  const handleDragEnter = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDragActive(true);
    }
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only deactivate when leaving the dropzone shell (not nested children).
    if (e.currentTarget === e.target) {
      setDragActive(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    processFile(file);
  };

  const handleCropComplete = (file: File, crop: Crop) => {
    setCroppedFile(file);
    setCropSelection(crop);
    // DECISION (nie usuwaj tego komentarza): `createObjectURL` woła się POZA
    // funkcyjnym updaterem stanu. StrictMode w dev wywołuje updatery DWA RAZY,
    // więc side-effect w środku tworzył dwa blob-URL-e, z których do stanu
    // trafiał tylko drugi — pierwszy zostawał bez właściciela i bez szansy na
    // `revokeObjectURL`. Ten sam wzorzec jest już opisany w
    // features/explore/hooks/useGalleryFilters.ts.
    if (croppedPreviewUrl) {
      URL.revokeObjectURL(croppedPreviewUrl);
    }
    setCroppedPreviewUrl(URL.createObjectURL(file));
    setStep(2);
  };

  const handleChangePhoto = () => {
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
    // DECISION (nie usuwaj tego komentarza):
    // GAL-3: snapshot photoCount===0 PRZED mutacja = zrodlo decyzji o celebracji.
    // Race-free (zamrozone przed onSettled-invalidate refetch) ORAZ reinstall-safe
    // (photoCount pochodzi z serwerowego useOwnGallery, nie z localStorage ktore
    // ginie przy reinstalu WebView). Dedykowana flaga backendowa CELOWO pominieta:
    // rozni sie tylko w rzadkim "skasuj wszystko -> wgraj ponownie" (powtorna
    // celebracja = nieszkodliwa). localStorage CELEBRATION_KEY usuniety.
    // Guard photoCount===0 with "gallery actually loaded" (galleryRecords defined):
    // a cold deep-link entry could publish while useOwnGallery is still in-flight
    // (data undefined -> count 0) and wrongly celebrate an existing stylist.
    // Trade-off tej bramki: gdy gallery query NIE zdazyl sie rozwiazac przy publish
    // (wolna siec / pierwszy load), genuine first upload dostaje zwykly success
    // zamiast celebracji (under-fire). Swiadomie akceptowane: under-fire jest
    // bezpieczniejszy niz false-celebration istniejacemu styliscie (over-fire).
    const wasFirstUpload = galleryRecords !== undefined && photoCount === 0;
    setPublishedOrdinal(galleryRecords !== undefined ? photoCount + 1 : null);
    try {
      await upload.mutateAsync(payload);
      if (wasFirstUpload) {
        // First-upload success haptic is owned by FirstPhotoCelebration's mount
        // effect (the peak) — firing one here too would double-buzz on native.
        setShowCelebration(true);
      } else {
        void hapticNotification('Success');
      }
      // DECISION (nie usuwaj tego komentarza) — pomiar 2026-09-09:
      // ZERO snackbara na sukcesie. Po publikacji cały ekran zamienia się
      // w UploadSuccessScreen (albo FirstPhotoCelebration), którego H1 brzmi
      // DOKŁADNIE tak samo jak treść toasta (`uploadSuccess`) — komunikat
      // przykrywał więc własny nagłówek tym samym zdaniem. Ekran jest
      // potwierdzeniem; toast zostaje wyłącznie dla BŁĘDU (catch niżej), gdzie
      // nie ma ekranu niosącego wiadomość.
    } catch (e) {
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

  // DECISION (nie usuwaj tego komentarza) — 2026-09-24:
  // Błąd publikacji NIE kasuje przygotowanej pracy. Ekran błędu wołał wcześniej
  // `handleReset`, który zerował plik, kadr, kolory, cechy i długość, więc
  // chwilowy brak sieci kosztował stylistkę całe przygotowanie od nowa.
  // Ponowienie publikuje TEN SAM szkic jeszcze raz; „wróć do podsumowania"
  // zdejmuje tylko stan mutacji (krok 3 z pełnym szkicem). `handleReset`
  // zostaje wyłącznie dla świadomego „Dodaj kolejne" po sukcesie.
  const handleRetryPublish = () => void handlePublish();
  const handleBackToSummary = () => upload.reset();

  const handleReset = () => {
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
    setShowCelebration(false);
    setPublishedOrdinal(null);
    upload.reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const selectedColorObjects = colors.filter(c =>
    selectedColorIds.includes(c.id)
  );
  const selectedTraitObjects = traits.filter(t =>
    selectedTraitIds.includes(t.id)
  );

  return {
    t,
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
    croppedFile,
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
    progressValue,
    canProceedStep2,
    step2BlockedReason,
    selectedColorObjects,
    selectedTraitObjects,
    isFirstUpload,
    photoCount,
    maxPhotos,
    currentPlan,
    planLimitReached,
    handleFileSelect,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleCropComplete,
    handleChangePhoto,
    toggleColor,
    toggleTrait,
    handlePublish,
    handleRetryPublish,
    handleBackToSummary,
    handleReset,
  };
}

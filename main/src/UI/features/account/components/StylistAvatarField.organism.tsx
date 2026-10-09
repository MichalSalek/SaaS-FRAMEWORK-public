// UI/features/account/components/StylistAvatarField.organism.tsx
// Zdjęcie profilowe stylistki na ekranie „Twój publiczny profil".
//
// DECISION (nie usuwaj tego komentarza) — decyzja ownera 2026-09-09:
// Wgrywamy AVATAR; okładka profilu zostaje generatywna (ton liczony z koloru
// marki). Dlatego jest tu jeden wybór pliku i żadnego pola na tło.
//
// Trzy stany zdjęcia, w tej kolejności: własne wgrane → obraz z konta Google →
// inicjały (`AvatarAtom`). „Usuń" cofa WYŁĄCZNIE pierwszy poziom, więc pokazuje
// się tylko wtedy, gdy jest co cofać — inaczej przycisk obiecywałby usunięcie
// zdjęcia, którego nie da się usunąć stąd (pochodzi z Google).

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { TrashIcon, UploadSimpleIcon } from '@phosphor-icons/react';
import type { SafeStylistAccount } from '@kernel/models/session/session.dto';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { isIOError } from '../../../../application/http/io';
import { useUploadAvatar } from '../hooks/useUploadAvatar';
import { AvatarCropDialogOrganism } from './AvatarCropDialog.organism';
import {
  ACCEPTED_IMAGE_ACCEPT_ATTR,
  isAcceptedImageMimeType,
} from '../../../shared/image/imageUpload.config';
import styles from './StylistAvatarField.module.css';

// Sufit wejściowy, nie docelowy: po kadrze do kwadratu i rekompresji do JPEG
// plik i tak schodzi do kilkuset kilobajtów. 8 MB przepuszcza zdjęcie prosto z
// telefonu, a odcina wrzucenie pliku z aparatu bezlusterkowego.
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

interface StylistAvatarFieldProps {
  stylistAccount: SafeStylistAccount;
}

export function StylistAvatarFieldOrganism({
  stylistAccount,
}: StylistAvatarFieldProps) {
  const t = useTranslations('account.avatar');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: user } = useCurrentUserAccount();
  const { upload, remove } = useUploadAvatar();

  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // DECISION (nie usuwaj tego komentarza):
  // Widoczność okienka kadru ma WŁASNY stan, oddzielny od wybranego pliku. Gdyby
  // zamknięcie polegało na wyzerowaniu pliku, całe okienko odmontowywałoby się w
  // tym samym takcie — a animacja wyjścia w AppDialog jest sterowana atrybutem
  // `data-ending-style`, który wymaga, żeby element ŻYŁ jeszcze przez czas
  // przejścia. Zamykanie przez odmontowanie daje więc szarpnięcie zamiast
  // wygaszenia (kanon: StylistUnpairDialog trzyma dialog zamontowany i przełącza
  // samo `open`). Plik i jego podgląd zostają do następnego wyboru albo do
  // odmontowania — zwalnia je efekt sprzątający poniżej.
  const [isCropOpen, setIsCropOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const ownAvatarUrl = stylistAccount.avatar_url;
  const fallbackImageUrl = user?.image ?? null;
  const effectiveAvatarUrl = ownAvatarUrl ?? fallbackImageUrl ?? undefined;
  const displayName =
    stylistAccount.display_name ?? user?.name ?? t('unnamedFallback');
  const isBusy = upload.isPending || remove.isPending;

  const closeCrop = () => {
    setIsCropOpen(false);
    // Bez zerowania inputa ponowny wybór TEGO SAMEGO pliku nie odpala `change`.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    if (!isAcceptedImageMimeType(file.type)) {
      pushNewSnackbar(t('invalidFileType'), 'error');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      pushNewSnackbar(t('fileTooLarge'), 'error');
      return;
    }
    setPickedFile(file);
    // `createObjectURL` woła się POZA funkcją aktualizującą stan: React w trybie
    // rygorystycznym wywołuje takie funkcje dwa razy, więc side-effect w środku
    // tworzyłby dwa adresy blob, z których jeden zostawałby bez właściciela i bez
    // szansy na zwolnienie (ta sama pułapka co w useUploadAssetState).
    setPreviewUrl(URL.createObjectURL(file));
    setIsCropOpen(true);
  };

  const handleCropConfirm = async (croppedFile: File) => {
    closeCrop();
    try {
      await upload.mutateAsync(croppedFile);
    } catch (e) {
      // Krok 2 (nasze API) toastuje interceptor po evencie backendu. Krok 1
      // (wysyłka pliku do chmury) omija interceptor, więc bez tego byłby niemy —
      // ale tylko dla niego, żeby nie dublować komunikatu (S82).
      if (!isIOError(e)) {
        pushNewSnackbar(t('uploadFailed'), 'error');
      }
    }
  };

  return (
    <div className={styles.field}>
      <p className={styles.label}>{t('label')}</p>

      <div className={styles.row}>
        <AvatarAtom
          src={effectiveAvatarUrl}
          name={displayName}
          size='xl'
          decorative
        />

        <div className={styles.actions}>
          <input
            ref={fileInputRef}
            type='file'
            accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
            onChange={handleFileSelect}
            className={styles.hiddenInput}
            aria-hidden='true'
            tabIndex={-1}
          />
          <ButtonAtom
            variant='outlined'
            size='sm'
            icon={<UploadSimpleIcon size={16} />}
            loading={isBusy}
            onClick={() => fileInputRef.current?.click()}>
            {ownAvatarUrl ? t('changeCta') : t('uploadCta')}
          </ButtonAtom>

          {ownAvatarUrl !== null && (
            <ButtonAtom
              variant='outlined'
              size='sm'
              icon={<TrashIcon size={16} />}
              disabled={isBusy}
              onClick={() => remove.mutate()}>
              {t('removeCta')}
            </ButtonAtom>
          )}
        </div>
      </div>

      <p className={styles.hint}>
        {ownAvatarUrl
          ? t('hintOwn')
          : fallbackImageUrl
            ? t('hintFromProvider')
            : t('hintInitials')}
      </p>

      {/* Dialog ZOSTAJE zamontowany po pierwszym wyborze pliku — zamyka go flaga
          `open`, nie odmontowanie, żeby animacja wyjścia miała czas się odegrać. */}
      {pickedFile && previewUrl && (
        <AvatarCropDialogOrganism
          open={isCropOpen}
          previewUrl={previewUrl}
          originalFile={pickedFile}
          onCancel={closeCrop}
          onConfirm={file => void handleCropConfirm(file)}
        />
      )}
    </div>
  );
}

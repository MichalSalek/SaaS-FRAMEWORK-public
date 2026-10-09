// UI/features/account/components/AvatarCropDialog.organism.tsx
// Kadrowanie zdjęcia profilowego do KWADRATU. Osobny komponent od kadru
// stylizacji (3:4): tam kadruje się pracę i trwa to trzy kroki kreatora, tutaj
// jest jedna decyzja w okienku. Wspólna jest matematyka wycinania
// (`shared/image/imageCrop.utils`), nie ekran.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ReactCrop, {
  convertToPixelCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import {
  centeredAspectCrop,
  cropToFile,
} from '../../../shared/image/imageCrop.utils';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import styles from './AvatarCropDialog.module.css';

// Avatary renderują się w kole (AvatarAtom), więc kadr MUSI być kwadratem —
// inaczej koło docina zdjęcie w miejscu, którego stylistka nie wybrała.
const ASPECT = 1;

interface AvatarCropDialogProps {
  open: boolean;
  /** Obiektowy URL wybranego pliku (podgląd do kadrowania). */
  previewUrl: string;
  originalFile: File;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
}

export function AvatarCropDialogOrganism({
  open,
  previewUrl,
  originalFile,
  onCancel,
  onConfirm,
}: AvatarCropDialogProps) {
  const t = useTranslations('account.avatar');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isProcessing, setIsProcessing] = useState(false);

  // Komponent przeżywa zamknięcie okienka (patrz DECISION w StylistAvatarField),
  // więc przy KOLEJNYM zdjęciu trzeba zapomnieć poprzedni kadr — inaczej przez
  // moment przed `onLoad` widać zaznaczenie z poprzedniego pliku, a „Zapisz"
  // wciśnięte w tym oknie wycięłoby kadr policzony dla innego obrazka.
  useEffect(() => {
    setCrop(undefined);
    setCompletedCrop(undefined);
  }, [previewUrl]);

  const onImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    imgRef.current = e.currentTarget;
    const startCrop = centeredAspectCrop(width, height, ASPECT);
    setCrop(startCrop);
    setCompletedCrop(convertToPixelCrop(startCrop, width, height));
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !completedCrop) {
      return;
    }
    setIsProcessing(true);
    try {
      const croppedFile = await cropToFile(
        imgRef.current,
        completedCrop,
        originalFile.name,
        'avatar'
      );
      onConfirm(croppedFile);
      // DECISION (nie usuwaj tego komentarza) — KADROWANIE MOZE ODMOWIC:
      // `cropToFile` rzuca przy braku kontekstu 2d i odrzuca obietnice, gdy
      // `toBlob` odda null — oba realne na telefonie pod presja pamieci, czyli
      // dokladnie przy duzym pliku, ktory ten ekran przyjmuje. Bez `catch` odrzucenie
      // szlo w nieobsluzona obietnice: spinner gasl, dialog stal otwarty i nie
      // padal zaden komunikat, wiec uzytkowniczka klikala „Zapisz" w kolko.
      //
      // DLACZEGO NIE MA AUTOMATYCZNEGO PONOWIENIA (rozstrzygniete S121):
      // Oba tryby awarii — brak kontekstu 2d i `toBlob` oddajace null — sa objawami
      // PRESJI PAMIECI. Automatyczne ponowienie powtarza DOKLADNIE te sama alokacje
      // w tym samym momencie, wiec w najlepszym razie nic nie zmienia, a w gorszym
      // podnosi szczyt zuzycia i opoznia jedyna rzecz, ktora naprawde pomaga:
      // komunikat. Ponowienie ISTNIEJE i jest RECZNE — `finally` zdejmuje
      // `isProcessing`, dialog zostaje otwarty, przycisk wraca do zycia, a toast
      // mowi wprost, ze mozna sprobowac jeszcze raz. To jest wlasciwy ksztalt dla
      // awarii zaleznej od stanu urzadzenia, ktory user moze zmienic (zamknac karty,
      // zwolnic pamiec) miedzy jedna a druga proba.
      // Gdyby ta sciezka kiedys wymagala realnej odpornosci, dzwignia jest
      // ZMNIEJSZENIE alokacji (downscale przed `toBlob`), nie powtarzanie jej.
    } catch {
      pushNewSnackbar(t('uploadFailed'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          onCancel();
        }
      }}>
      <AppDialogAtom.Content
        title={t('cropTitle')}
        description={t('cropHint')}
        className={styles.popup}>
        <div className={styles.cropWrapper}>
          {crop ? (
            <ReactCrop
              crop={crop}
              /* Trzymamy kadr PROCENTOWY (drugi argument): tylko procenty
                 przeżywają zmianę rozmiaru podglądu, więc wybór nie ucieka,
                 gdy okienko się przeskaluje. */
              onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
              onComplete={c => setCompletedCrop(c)}
              aspect={ASPECT}
              circularCrop
              keepSelection
              className={styles.reactCrop}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt={t('cropPreviewAlt')}
                onLoad={onImageLoaded}
                className={styles.cropImage}
              />
            </ReactCrop>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt={t('cropPreviewAlt')}
              onLoad={onImageLoaded}
              className={styles.cropImage}
            />
          )}
        </div>

        <AppDialogAtom.Actions>
          <ButtonAtom variant='ghost' size='sm' onClick={onCancel}>
            {t('cropCancel')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            onClick={() => void handleConfirm()}
            disabled={!completedCrop || isProcessing}
            className='haptic-press'>
            {isProcessing ? t('cropProcessing') : t('cropConfirm')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}

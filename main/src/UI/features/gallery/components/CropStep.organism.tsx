import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import ReactCrop, {
  convertToPixelCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import {
  centeredAspectCrop,
  cropToFile,
} from '../../../shared/image/imageCrop.utils';
import styles from './CropStep.module.css';

const ASPECT = 3 / 4;

interface CropStepProps {
  previewUrl: string;
  originalFile: File;
  /**
   * Kadr wybrany poprzednio (jednostka `%`, więc przeżywa zmianę rozmiaru
   * podglądu). `null` = pierwsze wejście, wtedy startujemy od wycentrowanych
   * 90% szerokości.
   */
  initialCrop: Crop | null;
  onCropComplete: (croppedFile: File, crop: Crop) => void;
  onChangePhoto: () => void;
}

export function CropStepOrganism({
  previewUrl,
  originalFile,
  initialCrop,
  onCropComplete,
  onChangePhoto,
}: CropStepProps) {
  const t = useTranslations('pages.gallery');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isProcessing, setIsProcessing] = useState(false);

  // DECISION (nie usuwaj tego komentarza) — zgłoszenie ownera 2026-09-09:
  // Kadr wjeżdża z góry (`initialCrop`), a nie rodzi się od nowa przy każdym
  // montażu. Komponent jest renderowany warunkowo i ładowany dynamicznie, więc
  // wejście „Wstecz → Edytuj kadr" montowało go świeżo i resetowało wybór do
  // wycentrowanych 90% — a ponowne „Zatwierdź" nadpisywało własny kadr
  // stylistki wersją domyślną.
  const onImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    imgRef.current = e.currentTarget;
    const startCrop = initialCrop ?? centeredAspectCrop(width, height, ASPECT);
    setCrop(startCrop);
    setCompletedCrop(convertToPixelCrop(startCrop, width, height));
  };

  // Plik, którego przeglądarka nie umie zdekodować (uszkodzony albo z typem
  // niezgodnym z treścią), nigdy nie odpalał `onLoad`: kadr się nie rodził,
  // „Zatwierdź" zostawał wyłączony, a na ekranie wisiało „Ładowanie podglądu".
  // Mówimy wprost i wracamy do wyboru pliku.
  const onImageError = () => {
    pushNewSnackbar(t('cropImageUnreadable'), 'error');
    onChangePhoto();
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !completedCrop || !crop) {
      return;
    }
    setIsProcessing(true);
    try {
      const croppedFile = await cropToFile(
        imgRef.current,
        completedCrop,
        originalFile.name,
        'crop'
      );
      onCropComplete(croppedFile, crop);
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
      // Własny komunikat kadrowania: `uploadFailed` („nie udało się dodać
      // zdjęcia") mówił o publikacji, której jeszcze nie było, i nie mówił,
      // że wystarczy spróbować ponownie (co obiecuje DECISION wyżej).
      pushNewSnackbar(t('cropFailed'), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={`${styles.cropStep} ${styles.cropStepEnter}`}>
      <div className={styles.cropHeader}>
        <TypographyAtom variant='h4'>{t('cropTitle')}</TypographyAtom>
        <TypographyAtom variant='caption' className={styles.cropHint}>
          {t('cropHint')}
        </TypographyAtom>
      </div>

      <div className={styles.cropWrapper}>
        {crop ? (
          <ReactCrop
            crop={crop}
            /* Trzymamy PROCENTOWY kadr (drugi argument), nie pikselowy:
               tylko procenty przeżywają zmianę rozmiaru podglądu i remontaż
               komponentu, więc zapamiętany wybór wraca w tym samym miejscu
               niezależnie od tego, jak duży jest obrazek na ekranie. */
            onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
            onComplete={c => setCompletedCrop(c)}
            aspect={ASPECT}
            keepSelection
            className={styles.reactCrop}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt={t('cropPreviewAlt')}
              onLoad={onImageLoaded}
              onError={onImageError}
              className={styles.cropImage}
            />
          </ReactCrop>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt={t('cropLoadingAlt')}
            onLoad={onImageLoaded}
            onError={onImageError}
            className={styles.cropImage}
          />
        )}
      </div>

      {/* DECISION (nie usuwaj tego komentarza) — owner 2026-10-08:
          jeden zwarty rząd, poboczna akcja z lewej jako widoczny przycisk
          (wariant `ghost` wyglądał jak podpis), główna z prawej i szersza.
          To jedyne miejsce w kreatorze, w którym zmienia się zdjęcie. */}
      <div className={styles.cropActions}>
        <ButtonAtom
          variant='outlined'
          size='md'
          onClick={onChangePhoto}
          ariaLabel={t('uploadPreviewChange')}
          disabled={isProcessing}>
          {t('cropChangePhoto')}
        </ButtonAtom>
        <ButtonAtom
          direction={isProcessing ? undefined : 'forward'}
          variant='primary'
          size='md'
          onClick={() => void handleConfirm()}
          disabled={!completedCrop || isProcessing}
          aria-busy={isProcessing || undefined}
          className={`${styles.cropConfirm} haptic-press`}>
          {isProcessing ? t('cropProcessing') : t('cropConfirm')}
        </ButtonAtom>
      </div>
    </div>
  );
}

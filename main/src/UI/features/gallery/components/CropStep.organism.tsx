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

  // DECISION: the crop arrives from above (`initialCrop`) instead of being born anew on every
  // mount. The component renders conditionally and loads dynamically, so "Back -> Edit crop"
  // mounted it fresh and reset the selection to a centred 90%, and the next "Zatwierdź" overwrote
  // the stylist's own crop with the default. (owner)
  const onImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    imgRef.current = e.currentTarget;
    const startCrop = initialCrop ?? centeredAspectCrop(width, height, ASPECT);
    setCrop(startCrop);
    setCompletedCrop(convertToPixelCrop(startCrop, width, height));
  };

  // A file the browser cannot decode (corrupt, or a type that contradicts its
  // content) never fires `onLoad`: no crop appears, „Zatwierdź" stays disabled
  // and „Ładowanie podglądu" hangs on screen. Say so plainly and go back to
  // file selection.
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
      // DECISION: cropping CAN refuse. `cropToFile` throws without a 2d context and rejects when
      // `toBlob` yields null, both real on a phone under memory pressure, i.e. exactly with the
      // large file this screen accepts. Without a `catch` the rejection went into an unhandled
      // promise: the spinner went out, the dialog stayed open and no message appeared, so she
      // tapped "Zapisz" in circles. There is NO automatic retry: both failure modes are symptoms of
      // MEMORY PRESSURE, and an automatic retry repeats exactly the same allocation at the same
      // moment, so at best it changes nothing and at worst raises the peak and delays the one thing
      // that helps: the message. The retry EXISTS and is MANUAL: `finally` clears `isProcessing`,
      // the dialog stays open, the button comes alive and the toast says she can try again. That is
      // the right shape for a failure that depends on device state the user can change (close tabs,
      // free memory) between attempts. If this path ever needs real resilience, the lever is a
      // SMALLER allocation (downscale before `toBlob`), not repeating it.
    } catch {
      // A crop-specific message: `uploadFailed` („nie udało się dodać zdjęcia”) would
      // speak of a publication that has not happened yet and not say that trying
      // again is enough (which the DECISION above promises).
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
            /* Keep the PERCENT crop (second argument), not the pixel one: only
               percentages survive a preview resize and a component remount, so
               the remembered choice returns to the same place however large the
               image is on screen. */
            onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
            onComplete={c => setCompletedCrop(c)}
            aspect={ASPECT}
            keepSelection
            className={styles.reactCrop}>
            <img
              src={previewUrl}
              alt={t('cropPreviewAlt')}
              onLoad={onImageLoaded}
              onError={onImageError}
              className={styles.cropImage}
            />
          </ReactCrop>
        ) : (
          <img
            src={previewUrl}
            alt={t('cropLoadingAlt')}
            onLoad={onImageLoaded}
            onError={onImageError}
            className={styles.cropImage}
          />
        )}
      </div>

      {/* DECISION: one compact row: the side action on the left as a visible button (the
          `ghost` variant looked like a caption), the main one on the right and wider. This is
          the only place in the wizard where the photo is changed. (owner) */}
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
          className={`${styles.cropConfirm} press-feedback`}>
          {isProcessing ? t('cropProcessing') : t('cropConfirm')}
        </ButtonAtom>
      </div>
    </div>
  );
}

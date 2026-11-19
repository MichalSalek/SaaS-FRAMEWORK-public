// UI/features/account/components/AvatarCropDialog.organism.tsx
// Crops the profile photo to a SQUARE. Separate from the work crop (3:4): that
// one is three wizard steps, this is one decision in a dialog. Only the crop
// math is shared (`shared/image/imageCrop.utils`), not the screen.

import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import ReactCrop, {
  convertToPixelCrop,
  type Crop,
  type PixelCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { AppDialogAtom } from '../../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../../components/Button/Button.atom';
import {
  centeredAspectCrop,
  cropToFile,
} from '../../../../shared/image/imageCrop.utils';
import { pushNewSnackbar } from '../../../../../application/app-snackbar/appSnackbar.possibilities.api';
import styles from './AvatarCropDialog.module.css';

// Avatars render in a circle (AvatarAtom), so the crop MUST be square, else
// the circle trims the photo where the stylist did not choose.
const ASPECT = 1;

interface AvatarCropDialogProps {
  open: boolean;
  mode?: 'person' | 'logo';
  /** Obiektowy URL wybranego pliku (podgląd do kadrowania). */
  previewUrl: string;
  originalFile: File;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
}

export function AvatarCropDialogOrganism({
  open,
  mode = 'person',
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
  const generation = useRef(0);
  const processing = useRef(false);

  // The component outlives the dialog closing (see the DECISION in StylistAvatarField), so for the
  // NEXT photo the previous crop must be forgotten: otherwise, for a moment before `onLoad`, the
  // selection of the previous file shows and "Zapisz" pressed in that window would cut a crop
  // computed for another image.
  useLayoutEffect(() => {
    generation.current += 1;
    processing.current = false;
    setIsProcessing(false);
    setCrop(undefined);
    setCompletedCrop(undefined);
    imgRef.current = null;
    return () => {
      generation.current += 1;
      processing.current = false;
    };
  }, [open, previewUrl, originalFile]);

  const cancel = () => {
    generation.current += 1;
    processing.current = false;
    setIsProcessing(false);
    onCancel();
  };

  const onImageLoaded = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    imgRef.current = e.currentTarget;
    const startCrop = centeredAspectCrop(width, height, ASPECT);
    setCrop(startCrop);
    setCompletedCrop(convertToPixelCrop(startCrop, width, height));
  };

  const handleConfirm = async () => {
    if (!open || processing.current || !imgRef.current || !completedCrop) {
      return;
    }
    const current = ++generation.current;
    processing.current = true;
    setIsProcessing(true);
    try {
      const croppedFile = await cropToFile(
        imgRef.current,
        completedCrop,
        originalFile.name,
        mode === 'logo' ? 'logo' : 'avatar',
        mode === 'logo' ? 'image/png' : 'image/jpeg'
      );
      if (current === generation.current) {
        onConfirm(croppedFile);
      }
      // DECISION: CROPPING CAN FAIL. `cropToFile` throws without a 2d context and rejects when
      // `toBlob` returns null, both real on a phone under memory pressure, i.e. exactly with the
      // large file this screen accepts. Without a `catch` the rejection went unhandled: the spinner
      // died, the dialog stayed open and no message appeared, so the user tapped "Zapisz" in a loop.
      // There is NO automatic retry on purpose: both failure modes are symptoms of memory pressure,
      // so a retry repeats exactly the same allocation at the same moment (at best nothing changes,
      // at worst it raises the peak). The retry exists and is MANUAL: `finally` clears
      // `isProcessing`, the dialog stays open, the button comes back and the toast says to try
      // again, which fits a failure tied to device state the user can change (close tabs, free
      // memory). If this path ever needs real resilience, the lever is a SMALLER allocation
      // (downscale before `toBlob`), not repeating it.
    } catch {
      if (current === generation.current) {
        pushNewSnackbar(t('uploadFailed'), 'error');
      }
    } finally {
      if (current === generation.current) {
        processing.current = false;
        setIsProcessing(false);
      }
    }
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          cancel();
        }
      }}>
      <AppDialogAtom.Content
        title={t(mode === 'logo' ? 'logoCropTitle' : 'cropTitle')}
        description={t(mode === 'logo' ? 'logoCropHint' : 'cropHint')}
        className={styles.popup}>
        <div className={styles.cropWrapper}>
          {crop ? (
            <ReactCrop
              crop={crop}
              /* Keep the PERCENT crop (second argument): only percentages survive a
                 preview resize, so the selection does not drift when the dialog
                 rescales. */
              onChange={(_pixelCrop, percentCrop) => setCrop(percentCrop)}
              onComplete={c => setCompletedCrop(c)}
              aspect={ASPECT}
              circularCrop={mode === 'person'}
              keepSelection
              className={styles.reactCrop}>
              <Image
                width={1000}
                height={1000}
                unoptimized
                src={previewUrl}
                alt={t(
                  mode === 'logo' ? 'logoCropPreviewAlt' : 'cropPreviewAlt'
                )}
                onLoad={onImageLoaded}
                className={styles.cropImage}
              />
            </ReactCrop>
          ) : (
            <Image
              width={1000}
              height={1000}
              unoptimized
              src={previewUrl}
              alt={t(mode === 'logo' ? 'logoCropPreviewAlt' : 'cropPreviewAlt')}
              onLoad={onImageLoaded}
              className={styles.cropImage}
            />
          )}
        </div>

        <AppDialogAtom.Actions>
          <ButtonAtom variant='ghost' size='sm' onClick={cancel}>
            {t('cropCancel')}
          </ButtonAtom>
          <ButtonAtom
            variant='primary'
            size='md'
            onClick={() => void handleConfirm()}
            disabled={!completedCrop || isProcessing}
            className='press-feedback'>
            {isProcessing
              ? t('cropProcessing')
              : t(mode === 'logo' ? 'logoCropConfirm' : 'cropConfirm')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}

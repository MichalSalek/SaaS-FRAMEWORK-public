import { useEffect } from 'react';
import Image from 'next/image';
import { XIcon } from '@phosphor-icons/react';
import { useTranslations } from 'next-intl';
import { NATIVE_BACK_EVENT } from '../../../../application/platform/native-back';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { AppModalShellAtom } from '../../../primitives/AppModalShell.atom';
import { useMaxScreenBrightness } from '../../../shared/hooks/useMaxScreenBrightness';
import styles from './UploadPhotoPreview.module.css';

export function UploadPhotoPreviewOrganism({
  src,
  open,
  onClose,
}: {
  src: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('pages.gallery');
  useMaxScreenBrightness(open);
  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnNativeBack = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    window.addEventListener(NATIVE_BACK_EVENT, closeOnNativeBack);
    return () =>
      window.removeEventListener(NATIVE_BACK_EVENT, closeOnNativeBack);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <AppModalShellAtom
      variant='fullscreen'
      label={t('uploadPreviewAlt')}
      onClose={onClose}
      portal
      inert='app-root'
      scrollLock
      className={styles.viewer}>
      <ButtonAtom
        variant='text'
        ariaLabel={t('uploadPreviewClose')}
        onClick={onClose}
        className={styles.dismiss}>
        <span className={styles.imageFrame}>
          <Image
            src={src}
            alt={t('uploadPreviewAlt')}
            fill
            sizes='100vw'
            className={styles.image}
            unoptimized
          />
        </span>
        <span className={styles.closeGlyph} aria-hidden='true'>
          <XIcon />
        </span>
      </ButtonAtom>
    </AppModalShellAtom>
  );
}

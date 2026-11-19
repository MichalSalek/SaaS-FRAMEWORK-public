// UI/features/gallery/components/UploadSourceZone.molecule.tsx
// Step 1 of „Dodaj stylizację”: where the photo comes from.
//
// DECISION: two obvious actions have their own buttons. The stylist usually already has the
// photo in her phone gallery, so picking from the phone is PRIMARY and the in-app camera is
// SECONDARY (`capture`). The whole card used to be ONE button that opened the system source
// chooser. The label says "from the phone", not "from the gallery": in this app the gallery is
// her works. The card still accepts a dropped file (computer). (owner)

import { useRef, type ChangeEvent, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  CameraIcon,
  CloudArrowUpIcon,
  ImagesIcon,
} from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import styles from '../UploadAssetPage.module.css';

interface UploadSourceZoneProps {
  /** A file is being dragged over the card (desktop). */
  dragActive: boolean;
  /** Runs right before either picker opens. */
  onBeforePick: () => void;
  /** Opens the library picker owned by the page (its input is reset there). */
  onPickFromPhone: () => void;
  onFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

export function UploadSourceZoneMolecule({
  dragActive,
  onBeforePick,
  onPickFromPhone,
  onFileSelect,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: UploadSourceZoneProps) {
  const t = useTranslations('pages.gallery');
  const cameraInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}>
      {/* Capacitor requires the image/* wildcard to dispatch capture to the
          camera. onFileSelect still validates the actual format; the library
          picker keeps its specific MIME filter. Clear after each shot. */}
      <input
        ref={cameraInputRef}
        type='file'
        accept='image/*'
        capture='environment'
        className={styles.hiddenInput}
        onChange={event => {
          onFileSelect(event);
          event.target.value = '';
        }}
      />
      <div className={styles.dropzoneIconHalo} aria-hidden='true'>
        <CloudArrowUpIcon size={36} weight='duotone' />
      </div>
      {dragActive && (
        <TypographyAtom
          variant='h4'
          align='center'
          className={styles.dropzoneTitle}>
          {t('uploadDropzoneDragActive')}
        </TypographyAtom>
      )}
      <TypographyAtom
        variant='body2'
        align='center'
        className={styles.dropzoneSubtitle}>
        {t('uploadDropzoneSubtitle')}
      </TypographyAtom>
      <div className={styles.dropzoneActions}>
        {/* DECISION: the stylist usually already has the photo in her phone
            gallery; she edits and shoots outside the app. Picking from the
            phone is therefore the primary action, and the in-app camera is the
            secondary one. (owner) */}
        <ButtonAtom
          variant='primary'
          size='lg'
          icon={<ImagesIcon size={20} />}
          onClick={() => {
            trackFlowStep('upload', 'source_chosen', { source: 'library' });
            onBeforePick();
            onPickFromPhone();
          }}>
          {t('uploadPickFromPhone')}
        </ButtonAtom>
        <ButtonAtom
          variant='outlined'
          size='lg'
          icon={<CameraIcon size={20} />}
          onClick={() => {
            trackFlowStep('upload', 'source_chosen', { source: 'camera' });
            onBeforePick();
            cameraInputRef.current?.click();
          }}>
          {t('uploadTakePhoto')}
        </ButtonAtom>
      </div>
      <span className={styles.dropzoneFormats}>
        {t('uploadDropzoneFormats')}
      </span>
    </div>
  );
}

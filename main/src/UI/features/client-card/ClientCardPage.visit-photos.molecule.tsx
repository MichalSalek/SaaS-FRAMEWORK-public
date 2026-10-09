// Photo strips of a visit card (result photos with removal, session
// inspirations). Extracted from ClientCardPage.visit-card (max-lines 300).

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { CameraIcon, XIcon } from '@phosphor-icons/react';
import type { VisitRecordDTO } from '@kernel/models/visit/visit.dto';
import styles from './ClientCardPage.module.css';

export function VisitResultPhotosMolecule({
  visit,
  onRemovePhoto,
  removingPhotoIds,
  uploading,
}: {
  visit: VisitRecordDTO;
  onRemovePhoto: (photoId: string) => void;
  /** Asks the card to confirm the removal (it is not undoable). */
  // Removal in flight: the X is disabled so a double tap sends one request.
  removingPhotoIds: ReadonlySet<string>;
  uploading: boolean;
}) {
  const t = useTranslations('clientCard');
  if (visit.resultPhotos.length === 0 && !uploading) {
    return null;
  }
  return (
    <div className={styles.photoBlock}>
      <p className={styles.photoBlockTitle}>{t('resultPhotos')}</p>
      <div className={styles.photoGrid}>
        {visit.resultPhotos.map((photo, index) => (
          <span key={photo.id} className={styles.photoTile}>
            <Image
              src={photo.assetUrl}
              alt={t('photoAlt', { index: index + 1 })}
              fill
              sizes='96px'
              className={styles.photoImage}
            />
            {/* 44px tap target; the visible disc inside is smaller. */}
            <button
              type='button'
              className={styles.removePhoto}
              onClick={() => onRemovePhoto(photo.id)}
              disabled={removingPhotoIds.has(photo.id)}
              aria-busy={removingPhotoIds.has(photo.id)}
              aria-label={t('removePhotoNumbered', { index: index + 1 })}>
              <span className={styles.removePhotoDisc} aria-hidden='true'>
                <XIcon size={14} weight='bold' />
              </span>
            </button>
          </span>
        ))}
        {uploading && (
          <span className={styles.uploadingTile} role='status'>
            <CameraIcon size={18} aria-hidden='true' />
            {t('uploadingPhoto')}
          </span>
        )}
      </div>
    </div>
  );
}

export function PhotoStripMolecule({
  title,
  urls,
  altPrefix,
}: {
  title: string;
  urls: string[];
  altPrefix: string;
}) {
  const tAlt = useTranslations('clientCard');
  return (
    <div className={styles.photoBlock}>
      <p className={styles.photoBlockTitle}>{title}</p>
      <div className={styles.photoGrid}>
        {urls.map((url, index) => (
          <span key={`${url}-${index}`} className={styles.photoTile}>
            <Image
              src={url}
              alt={tAlt('photoTileAlt', {
                prefix: altPrefix,
                index: index + 1,
              })}
              fill
              sizes='96px'
              className={styles.photoImage}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

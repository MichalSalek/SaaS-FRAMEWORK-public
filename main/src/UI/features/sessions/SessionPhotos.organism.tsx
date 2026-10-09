// UI/features/sessions/SessionPhotos.organism.tsx
// The photos of one session, shared by the client's and the stylist's detail:
// a labelled block with the first chosen photo large and the rest in a strip.

import { useState, type ReactNode } from 'react';
import type { SessionContainerPhotoDTO } from '@kernel/models/session-container/session-container.dto';
import { getCloudinaryThumbUrl } from '../../../application/cloudinary/cloudinary-url.utils';
import styles from './SessionPhotos.module.css';

/* DECISION (nie usuwaj tego komentarza):
 * Apple Photos memories pattern. The first chosen photo gets a large frame
 * (image is queen). Remaining photos sit as a horizontal thumbnail strip
 * beneath, scrollable on overflow. Click any → photo detail. A single photo
 * collapses gracefully to the large one only. */
export function SessionPhotosOrganism({
  photos,
  onOpenPhoto,
  label,
  countLabel,
  heroAlt,
  thumbAlt,
  empty,
}: {
  photos: SessionContainerPhotoDTO[];
  onOpenPhoto: (galleryRecordId: string) => void;
  label: string;
  /** Shown next to the label when there are photos. */
  countLabel: string;
  heroAlt: string;
  thumbAlt: string;
  /** Rendered under the label when the session has no photos. */
  empty?: ReactNode;
}) {
  const heroPhoto = photos[0];
  const stripPhotos = photos.slice(1);

  return (
    <section className={styles.block}>
      <div className={styles.header}>
        <h2 className={styles.label}>{label}</h2>
        {heroPhoto !== undefined && (
          <span className={styles.count}>{countLabel}</span>
        )}
      </div>

      {heroPhoto !== undefined ? (
        <PhotoButton
          photo={heroPhoto}
          onClick={onOpenPhoto}
          alt={heroAlt}
          size='hero'
        />
      ) : (
        empty
      )}

      {stripPhotos.length > 0 && (
        <div className={styles.strip} role='list'>
          {stripPhotos.map(photo => (
            // Interactive <button> must not carry the non-interactive
            // 'listitem' role (WCAG/ARIA): the semantics live on the wrapper.
            <div key={photo.id} role='listitem' className={styles.stripItem}>
              <PhotoButton
                photo={photo}
                onClick={onOpenPhoto}
                alt={thumbAlt}
                size='thumb'
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* One photo tile. The BUTTON owns the square box, so the tile has its final
 * size before the image arrives and after it fails (a vanished Cloudinary
 * object would otherwise leave a broken-image icon); the button's own neutral
 * fill is then the placeholder. */
function PhotoButton({
  photo,
  onClick,
  alt,
  size,
}: {
  photo: SessionContainerPhotoDTO;
  onClick: (galleryRecordId: string) => void;
  alt: string;
  size: 'hero' | 'thumb';
}) {
  const [imgError, setImgError] = useState(false);
  const url = photo.galleryRecord?.asset_url;
  return (
    <button
      type='button'
      className={`${styles.photoButton} haptic-press`}
      aria-label={alt}
      onClick={() => onClick(photo.galleryRecordId)}>
      {url && !imgError ? (
        // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URL
        <img
          src={getCloudinaryThumbUrl(url, size === 'hero' ? 800 : 200)}
          alt=''
          className={styles.photoImage}
          loading={size === 'hero' ? 'eager' : 'lazy'}
          onError={() => setImgError(true)}
        />
      ) : null}
    </button>
  );
}

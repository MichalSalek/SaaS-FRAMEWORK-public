// UI/features/sessions/SessionPhotos.organism.tsx
// The photos of one session, shared by the client's and the stylist's detail:
// a labelled block with the first chosen photo large and the rest in a strip.

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { XIcon } from '@phosphor-icons/react';
import type { SessionContainerPhotoDTO } from '@kernel/models/session-container/session-container.dto';
import {
  getCloudinaryFrameSrcSet,
  getCloudinaryFrameUrl,
} from '../../../application/cloudinary/cloudinary-url.utils';
import styles from './SessionPhotos.module.css';

/* The screen column is the phone's width, capped where the app view stops
 * growing. */
const FULL_WIDTH_SIZES = '(min-width: 768px) 720px, 100vw';

/* DECISION: a strip tile is NOT a thumbnail of a fixed size. The strip is a grid of
   `minmax(96px, 1fr)` columns, so ONE remaining photo is as wide as the large one, two take half
   each, and only four or more fall to 96px. The tile tells the browser its real width; the old
   fixed 200px version was drawn 350px wide on a 2x phone ("niewyraźny, rozpikselowany"). (owner
   2026-10-10) */
function stripSizes(count: number): string {
  if (count === 1) {
    return FULL_WIDTH_SIZES;
  }
  if (count === 2) {
    return '(min-width: 768px) 360px, 50vw';
  }
  if (count === 3) {
    return '(min-width: 768px) 240px, 34vw';
  }
  return '(min-width: 768px) 180px, 96px';
}

/* The first chosen photo gets a large frame (image is queen); the remaining photos sit as a
   horizontal thumbnail strip beneath, scrollable on overflow. Click any to open the photo
   detail. A single photo collapses to the large one only. */
export function SessionPhotosOrganism({
  photos,
  onOpenPhoto,
  label,
  countLabel,
  heroAlt,
  thumbAlt,
  empty,
  ownAuthorAccountId,
  removal,
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
  /** The stylist the session is for. A photo is signed with its author's name
   *  only when the author is SOMEONE ELSE (a work from the salon's shared
   *  gallery): under her own works the name repeated the row above the
   *  photos once per photo. */
  ownAuthorAccountId?: string | null;
  /** The client's own open session: each photo carries a control that takes
   *  it out of the session. */
  removal?: {
    label: string;
    onRemove: (galleryRecordId: string) => void;
    isPending: (galleryRecordId: string) => boolean;
  };
}) {
  const heroPhoto = photos[0];
  const stripPhotos = photos.slice(1);

  return (
    <section className={styles.block}>
      <div className={styles.header}>
        <h2 className={styles.label} data-app-section-title=''>
          {label}
        </h2>
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
          sizes={FULL_WIDTH_SIZES}
          ownAuthorAccountId={ownAuthorAccountId}
          removal={removal}
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
                sizes={stripSizes(stripPhotos.length)}
                ownAuthorAccountId={ownAuthorAccountId}
                removal={removal}
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
  sizes,
  ownAuthorAccountId,
  removal,
}: {
  photo: SessionContainerPhotoDTO;
  onClick: (galleryRecordId: string) => void;
  alt: string;
  size: 'hero' | 'thumb';
  /** The width the tile is drawn at, for the browser's choice from `srcSet`. */
  sizes: string;
  ownAuthorAccountId?: string | null | undefined;
  removal?:
    | {
        label: string;
        onRemove: (galleryRecordId: string) => void;
        isPending: (galleryRecordId: string) => boolean;
      }
    | undefined;
}) {
  const [imgError, setImgError] = useState(false);
  const tLabels = useTranslations('labels');
  const url = photo.galleryRecord?.asset_url;
  const author = photo.galleryRecord?.author;
  const showAuthor =
    author !== undefined &&
    (ownAuthorAccountId === undefined ||
      ownAuthorAccountId === null ||
      photo.galleryRecord?.created_by_account_id !== ownAuthorAccountId);
  const removing = removal?.isPending(photo.galleryRecordId) ?? false;
  return (
    <div className={styles.authoredPhoto}>
      <div className={styles.photoFrame} data-removing={removing || undefined}>
        <button
          type='button'
          className={`${styles.photoButton} press-feedback`}
          aria-label={alt}
          onClick={() => onClick(photo.galleryRecordId)}>
          {url && !imgError ? (
            <img
              src={getCloudinaryFrameUrl(
                url,
                '1:1',
                size === 'hero' ? 800 : 400
              )}
              srcSet={getCloudinaryFrameSrcSet(url, '1:1')}
              sizes={sizes}
              alt=''
              className={styles.photoImage}
              loading={size === 'hero' ? 'eager' : 'lazy'}
              onError={() => setImgError(true)}
            />
          ) : null}
        </button>
        {/* A sibling of the photo button, never inside it (a control in a
          control has no accessible description). */}
        {removal !== undefined && (
          <button
            type='button'
            className={styles.removeButton}
            aria-label={removal.label}
            title={removal.label}
            disabled={removing}
            aria-busy={removing || undefined}
            onClick={() => removal.onRemove(photo.galleryRecordId)}>
            <XIcon size={16} weight='bold' aria-hidden='true' />
          </button>
        )}
      </div>
      {/* A member onboarded with the role alone has no name yet. */}
      {showAuthor && (
        <span className={styles.author}>
          {author.name || tLabels('stylistFallback')}
        </span>
      )}
    </div>
  );
}

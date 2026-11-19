// UI/features/sessions/components/SessionConclusionCard.tsx
// Post-session retention card shown when a session has ended or expired.
//
// DECISION: post-session conclusion (Peak-End + Reciprocity micro-touch) to drive follow/like
// retention. Rendered only for TERMINAL sessions (CLOSED/EXPIRED), to avoid clutter during the
// active inspiration flow. On a finished session this card IS the photo block: it shows every photo
// (each opens its detail) with the like toggle on top, so the page does not repeat the same photos
// in a second grid above it.

import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { HeartIcon, ArrowLeftIcon, CopyIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { ImagePlaceholderAtom } from '../../../components/ImagePlaceholder/ImagePlaceholder.atom';
import { TypographyAtom } from '../../../components/Typography/Typography.atom';
import styles from './SessionConclusionCard.module.css';

/* ─── Types ─── */

interface SessionConclusionPhoto {
  id: string;
  galleryRecordId: string;
  galleryRecord?: {
    asset_url: string;
  };
}

export interface SessionConclusionCardProps {
  session: {
    stylistName: string | null;
    photos: SessionConclusionPhoto[];
    /** True only when the session was shared AND closed: that alone writes a
     *  visit into the client's history (an expired share or a closed draft
     *  does not), so only then may the title speak of a visit. */
    endedAsVisit: boolean;
  };
  onOpenPhoto: (galleryRecordId: string) => void;
  onLikePhoto: (
    galleryRecordId: string,
    isFavorited: boolean,
    onError?: () => void
  ) => void;
  likedPhotoIds?: ReadonlySet<string>;
  /** A closed session cannot be reopened; this starts a fresh one with the
   *  same inspiration. */
  onDuplicate?: (() => void) | undefined;
  isDuplicating?: boolean | undefined;
}

/* ─── Component ─── */

function ConclusionPhotoImg({ src, alt }: { src: string; alt: string }) {
  // Fallback when the image does NOT load from the CDN (404/timeout): without it a vanished Cloudinary object shows a broken-image icon.
  const [imgError, setImgError] = useState(false);
  return imgError ? (
    <ImagePlaceholderAtom size='md' />
  ) : (
    <img src={src} alt={alt} loading='lazy' onError={() => setImgError(true)} />
  );
}

export function SessionConclusionCardOrganism({
  session,
  onOpenPhoto,
  onLikePhoto,
  // DECISION: likedPhotoIds is a seam for future wiring: today NO caller passes it, so hearts start
  // empty even for photos already liked elsewhere (Explore). The effect is COSMETIC and data-safe:
  // the first tap on an already-liked photo calls addRecordToFavorites_IO, the backend returns
  // RECORD_ALREADY_IN_FAVORITES (P2002), the interceptor is silenced (silentBusinessError in
  // useToggleFavorite) and onError reverts the optimistic heart; the DB record is untouched and
  // liking still works from Explore/Favorites. Real feeding needs a "favorites by the session's
  // galleryRecordId" query that does not exist yet; restore the seed when it does. The card is
  // terminal-only and the edge is narrow (liked elsewhere AND present in a terminal session):
  // knowingly deferred to wiring, not a bug to mask.
  likedPhotoIds = new Set(),
  onDuplicate,
  isDuplicating = false,
}: SessionConclusionCardProps) {
  const t = useTranslations('pages.sessions.conclusion');
  const router = useRouter();

  const visiblePhotos = session.photos;
  const photoCount = session.photos.length;
  const stylistName = session.stylistName ?? '';

  const [localLiked, setLocalLiked] = useState<Set<string>>(
    () => new Set(likedPhotoIds)
  );

  const handleLike = (galleryRecordId: string) => {
    const isFavorited = localLiked.has(galleryRecordId);
    // Optimistic local update
    setLocalLiked(prev => {
      const next = new Set(prev);
      if (isFavorited) {
        next.delete(galleryRecordId);
      } else {
        next.add(galleryRecordId);
      }
      return next;
    });
    // The like mutation suppresses global errors — on failure revert the
    // optimistic localLiked entry so the heart reflects the real state.
    onLikePhoto(galleryRecordId, isFavorited, () => {
      setLocalLiked(prev => {
        const next = new Set(prev);
        if (isFavorited) {
          next.add(galleryRecordId);
        } else {
          next.delete(galleryRecordId);
        }
        return next;
      });
    });
  };

  return (
    <section className={styles.card} data-app-section='plain'>
      {/* ── Heading ── */}
      <div className={styles.headingRow}>
        {/* as='h2': the card is a top-level peer section under the hero <h1> and
            the photo block <h2> (a11y WCAG 1.3.1, no skipped levels; variant='h4'
            keeps the look). The redundant section aria-label was removed (it
            duplicated the visible heading). */}
        <TypographyAtom variant='h4' as='h2' data-app-section-title=''>
          {t(session.endedAsVisit ? 'title' : 'titleEnded', { stylistName })}
        </TypographyAtom>
        <TypographyAtom variant='body2' className={styles.body}>
          {t('body', { count: photoCount })}
        </TypographyAtom>
      </div>

      {/* ── Photo grid with like buttons ── */}
      {visiblePhotos.length > 0 && (
        <div className={styles.photoGrid}>
          {visiblePhotos.map((photo, i) => {
            const isLiked = localLiked.has(photo.galleryRecordId);
            return (
              <div key={photo.id} className={styles.photoItem}>
                <div className={styles.photoThumb}>
                  <button
                    type='button'
                    className={`${styles.photoOpen} press-feedback`}
                    onClick={() => onOpenPhoto(photo.galleryRecordId)}>
                    {photo.galleryRecord?.asset_url ? (
                      <ConclusionPhotoImg
                        src={photo.galleryRecord.asset_url}
                        alt={t('photoAlt', { index: i + 1 })}
                      />
                    ) : (
                      <span className={styles.photoPlaceholder} />
                    )}
                  </button>
                  {/* DECISION: a raw <button> stays, on purpose. This is not an action button
                      of the row/card family but a TOGGLE (`aria-pressed`) stuck on a photo tile
                      with its own geometry: `ButtonAtom` has no pressed state and its size
                      would burst the overlay. The token `likeBtn` deliberately does NOT belong
                      to the families watched by `button-primitives` (`*iconBtn`/`*actionBtn`).
                      If a `<ToggleButton>` primitive appears, it is the proper target. */}
                  <button
                    type='button'
                    aria-label={isLiked ? t('unlikeAlt') : t('likeAlt')}
                    aria-pressed={isLiked}
                    className={`${styles.likeBtn} ${isLiked ? styles.liked : ''} press-feedback`}
                    onClick={() => handleLike(photo.galleryRecordId)}>
                    <span className={styles.likeDisc}>
                      <HeartIcon
                        size={16}
                        weight={isLiked ? 'fill' : 'regular'}
                      />
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Like hint ── */}
      <TypographyAtom variant='caption' className={styles.likeHint}>
        {t('likeHint')}
      </TypographyAtom>

      {/* ── CTAs ── */}
      {/* The „follow the stylist” idea was dropped: the app has no feed, so a
       * soft connection with a stylist is SAVING to favorites (BOOKMARK_STYLIST,
       * on the profile), not „following”. Dead follow props/keys removed. */}
      <div className={styles.ctas}>
        {onDuplicate && (
          <ButtonAtom
            variant='primary'
            size='md'
            icon={<CopyIcon size={18} />}
            className='press-feedback'
            loading={isDuplicating}
            disabled={isDuplicating}
            onClick={onDuplicate}>
            {t(isDuplicating ? 'duplicatePending' : 'duplicateCta')}
          </ButtonAtom>
        )}
        <ButtonAtom
          variant='outlined'
          size='md'
          icon={<ArrowLeftIcon size={18} />}
          className='press-feedback'
          onClick={() => void router.push(ROUTES_FRONT.CLIENT_SESSIONS)}>
          {t('allVisitsCta')}
        </ButtonAtom>
      </div>
    </section>
  );
}

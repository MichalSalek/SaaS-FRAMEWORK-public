// UI/features/sessions/components/SessionConclusionCard.tsx
// Post-session retention card shown when a session has ended or expired.
//
// DECISION (nie usuwaj tego komentarza):
// N9 Peak-End + N2 Reciprocity micro-touch: post-session conclusion → drive
// follow/like retention. Rendered only for TERMINAL sessions (CLOSED/EXPIRED)
// to avoid clutter during active inspiration flow.
// On a finished session this card IS the photo block: it shows every photo
// (each opens its detail) with the like toggle on top, so the page does not
// repeat the same photos in a second grid above it.

import { useState } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { HeartIcon, ArrowLeftIcon } from '@phosphor-icons/react';
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
  };
  onOpenPhoto: (galleryRecordId: string) => void;
  onLikePhoto: (
    galleryRecordId: string,
    isFavorited: boolean,
    onError?: () => void
  ) => void;
  likedPhotoIds?: ReadonlySet<string>;
}

/* ─── Component ─── */

function ConclusionPhotoImg({ src, alt }: { src: string; alt: string }) {
  // Fallback gdy obraz NIE załaduje się z CDN (404/timeout) — bez tego zniknięty obiekt Cloudinary daje złamaną ikonkę obrazka.
  const [imgError, setImgError] = useState(false);
  return imgError ? (
    <ImagePlaceholderAtom size='md' />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- Cloudinary URLs, next/image incompatible with external transformations
    <img src={src} alt={alt} loading='lazy' onError={() => setImgError(true)} />
  );
}

export function SessionConclusionCardOrganism({
  session,
  onOpenPhoto,
  onLikePhoto,
  // DECISION (nie usuwaj tego komentarza): likedPhotoIds jest seam pod przyszłe
  // wiring — dziś ŻADEN caller go nie podaje, więc serca startują puste także dla
  // zdjęć już polubionych gdzie indziej (Explore). Skutek jest KOSMETYCZNY i bezpieczny
  // dla danych: pierwszy tap na już-polubionym zdjęciu wywołuje addRecordToFavorites_IO,
  // backend zwraca RECORD_ALREADY_IN_FAVORITES (P2002), interceptor jest wyciszony
  // (silentBusinessError w useToggleFavorite) i onError cofa optymistyczne serce — rekord
  // w DB nietknięty, polubienie nadal działa z Explore/Favorites. Realne zasilenie wymaga
  // query „favorites po galleryRecordId sesji", którego jeszcze nie ma; przywróć seed,
  // gdy powstanie. Karta terminal-only + wąski edge (zdjęcie polubione gdzie indziej I
  // obecne w sesji terminalnej) → świadomie odłożone do wiringu, nie bug do maskowania.
  likedPhotoIds = new Set(),
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
    <section className={styles.card}>
      {/* ── Heading ── */}
      <div className={styles.headingRow}>
        {/* as='h2': karta to sekcja-peer top-level pod hero <h1> i blokiem zdjęć <h2>
            (a11y WCAG 1.3.1 — bez pomijania poziomów; wariant='h4' trzyma wygląd).
            Usunięto redundantny aria-label sekcji (dublował widoczny nagłówek). */}
        <TypographyAtom variant='h4' as='h2'>
          {t('title', { stylistName })}
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
                    className={`${styles.photoOpen} haptic-press`}
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
                  {/* DECISION (nie usuwaj tego komentarza) — S113:
                      Zostaje surowy <button>, świadomie. To nie jest przycisk akcji
                      z rodziny wiersza/karty, tylko PRZEŁĄCZNIK (`aria-pressed`)
                      naklejony na kafel zdjęcia, o własnej geometrii — `ButtonAtom`
                      nie ma stanu wciśnięcia, a jego rozmiar rozsadziłby nakładkę.
                      Token `likeBtn` celowo NIE należy do rodzin pilnowanych przez
                      `button-primitives` (`*iconBtn`/`*actionBtn`). Gdyby powstał
                      prymityw `<ToggleButton>`, to on jest właściwym adresatem. */}
                  <button
                    type='button'
                    aria-label={isLiked ? t('unlikeAlt') : t('likeAlt')}
                    aria-pressed={isLiked}
                    className={`${styles.likeBtn} ${isLiked ? styles.liked : ''} haptic-press`}
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
      {/* Pomysł „obserwuj stylistkę" porzucony (2026-07-12): apka nie ma feedu,
       * więc soft-połączenie ze stylistką to ZAPIS do ulubionych (BOOKMARK_STYLIST,
       * na profilu), nie „obserwowanie". Martwe propsy/klucze follow usunięte. */}
      <div className={styles.ctas}>
        <ButtonAtom
          variant='outlined'
          size='md'
          icon={<ArrowLeftIcon size={18} />}
          className='haptic-press'
          onClick={() => void router.push(ROUTES_FRONT.CLIENT_SESSIONS)}>
          {t('allVisitsCta')}
        </ButtonAtom>
      </div>
    </section>
  );
}

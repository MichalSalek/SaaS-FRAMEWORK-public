import { getLocalizedTaxonomyName } from '../../../../domain/gallery/gallery-taxonomy.locale';
// SimilarSection — "Podobne stylizacje" section for PhotoDetailPage.
// Client-side scoring: shared_color +1, shared_trait +2.
// Shows top 4 similar records as a horizontal scrollable row.

import { useMemo, useState } from 'react';
import { AppLinkAtom as Link } from '../../../components/AppLink/AppLink.atom';
import { useLocale, useTranslations } from 'next-intl';
import type { PhotoDetailData } from '../../shared/gallery/hooks/usePhotoDetail';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import { getCloudinaryThumbUrl } from '../../../../application/cloudinary/cloudinary-url.utils';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import { ImagePlaceholderAtom } from '../../../components/ImagePlaceholder/ImagePlaceholder.atom';
import styles from './SimilarSection.module.css';

/* --- Types --- */

type GalleryRecord =
  GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['RESPONSE']['records'][number];

interface SimilarSectionProps {
  /** Current photo detail data (for scoring against) */
  currentPhoto: PhotoDetailData;
  /** All gallery records from the same stylist to score against */
  allRecords: GalleryRecord[];
}

/* --- Scoring --- */

const SCORE_SHARED_COLOR = 1;
const SCORE_SHARED_TRAIT = 2;
const MAX_SIMILAR = 4;

function scoreSimilarity(
  current: PhotoDetailData['gallery_record'],
  candidate: GalleryRecord
): number {
  let score = 0;

  const currentColorIds = new Set(current.colors.map(c => c.id));
  candidate.colors.forEach(c => {
    if (currentColorIds.has(c.id)) {
      score += SCORE_SHARED_COLOR;
    }
  });

  const currentTraitIds = new Set(current.traits.map(t => t.id));
  candidate.traits.forEach(t => {
    if (currentTraitIds.has(t.id)) {
      score += SCORE_SHARED_TRAIT;
    }
  });

  return score;
}

/* --- Component --- */

function SimilarThumbImg({ src, alt }: { src: string; alt: string }) {
  // Fallback gdy obraz NIE załaduje się z CDN (404/timeout) — bez tego zniknięty obiekt Cloudinary daje złamaną ikonkę obrazka.
  const [imgError, setImgError] = useState(false);
  return imgError ? (
    <ImagePlaceholderAtom size='md' className={styles.thumbImage} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element -- gallery thumbnails
    <img
      src={src}
      alt={alt}
      className={styles.thumbImage}
      loading='lazy'
      onError={() => setImgError(true)}
    />
  );
}

export function SimilarSectionOrganism({
  currentPhoto,
  allRecords,
}: SimilarSectionProps) {
  const locale = useLocale();
  const t = useTranslations('pages.gallery');
  const similarRecords = useMemo(() => {
    const { gallery_record } = currentPhoto;
    const currentId = gallery_record.gallery_record_id;

    return allRecords
      .filter(r => r.gallery_record_id !== currentId)
      .map(record => ({
        record,
        score: scoreSimilarity(gallery_record, record),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SIMILAR)
      .map(item => item.record);
  }, [currentPhoto, allRecords]);

  if (similarRecords.length === 0) {
    return null;
  }

  return (
    <>
      <div className={styles.separator} />
      <section className={styles.section}>
        <header className={styles.header}>
          <h3 className={`${styles.title} fontAccent`}>{t('similarTitle')}</h3>
        </header>
        <div className={styles.scrollRow}>
          {similarRecords.map(record => (
            <Link
              key={record.gallery_record_id}
              href={buildRoute(ROUTES_FRONT.PHOTO_DETAIL, {
                id: record.gallery_record_id,
              })}
              className={styles.thumb}>
              <SimilarThumbImg
                src={getCloudinaryThumbUrl(record.asset_url, 200)}
                alt={t('similarPhotoAlt', {
                  traits: record.traits
                    .map(tr => getLocalizedTaxonomyName(tr.name, locale))
                    .join(', '),
                })}
              />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}

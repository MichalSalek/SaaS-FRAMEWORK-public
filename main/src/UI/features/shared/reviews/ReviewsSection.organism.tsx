import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { DisclosurePanelAtom } from '../../../components/Disclosure/DisclosurePanel.atom';
import { trackDemoInteraction } from '../../../../application/analytics/cta-events';
import type { BetaReview } from './ReviewsData';
import { splitLastSentence } from './reviewQuote.helpers';
import styles from './ReviewsSection.module.css';

interface ReviewsSectionProps {
  reviews: ReadonlyArray<BetaReview>;
  /** Leaf key under i18n namespace `static.reviews`. */
  headlineKey?: string;
  /**
   * Forces a specific review of the set to be first, when the automatic „longest
   * review” picks a voice that does not fit the page context (e.g. a solo stylist
   * under the heading „Co mówią salony”). An id outside `reviews`, or no prop =
   * automatic. First + the rest = still the WHOLE set, so JSON-LD `reviewCount`
   * is unchanged.
   */
  heroReviewId?: BetaReview['id'];
}

const RATING_SCALE = [1, 2, 3, 4, 5] as const;
/** The row counts as scrolled once the first card has moved this far. */
const ROW_SCROLLED_PX = 40;

/**
 * Rating mark = a nail plate: domed top, slight taper towards the cuticle, soft bottom.
 *
 * DECISION: the rating does not come back as a star. A rating is data, so it stays, but in
 * the brand's own mark (Michelin counts in macarons, we count in nails); `audit:no-sparkle`
 * still bans StarIcon/Sparkle/4-point paths and does not cover this mark. (owner)
 */
const NAIL_PATH =
  'M6 1.3c2.4 0 3.9 1.9 3.9 4.9l-.35 8.3c-.1 2.4-1.4 4.2-3.55 4.2s-3.45-1.8-3.55-4.2L2.1 6.2C2.1 3.2 3.6 1.3 6 1.3Z';

function formatPlace(review: BetaReview): string {
  return review.salon ? `${review.salon}, ${review.city}` : review.city;
}

export function ReviewsSectionOrganism({
  reviews,
  headlineKey = 'stylistsHeadline',
  heroReviewId,
}: ReviewsSectionProps) {
  const t = useTranslations('static.reviews');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const rowScrolled = useRef(false);

  /* The marks are `aria-hidden`: the container's `aria-label` carries the whole rating. */
  const rating = (review: BetaReview) => (
    <span
      className={styles.rating}
      role='img'
      aria-label={t('ratingAria', { rating: review.rating })}>
      {RATING_SCALE.map(step => (
        <svg
          key={step}
          className={step <= review.rating ? styles.nailOn : styles.nailOff}
          viewBox='0 0 12 20'
          aria-hidden='true'>
          <path d={NAIL_PATH} />
        </svg>
      ))}
    </span>
  );

  const first = reviews[0];
  if (first == null) {
    return null;
  }

  /* First: the explicitly chosen review (`heroReviewId`, if it is in the set),
     otherwise the set's longest review: a deterministic choice per locale that
     works for any set without hardcoding a review. */
  const pinned = reviews.find(review => review.id === heroReviewId);
  const lead =
    pinned ??
    reviews.reduce(
      (best, review) =>
        t(review.quoteKey).length > t(best.quoteKey).length ? review : best,
      first
    );
  const rest = reviews.filter(review => review.id !== lead.id);
  const { lead: before, last } = splitLastSentence(t(lead.quoteKey));

  const author = (review: BetaReview) => (
    <>
      <span className={styles.authorMeta}>
        <cite className={styles.authorName}>{review.authorName}</cite>
        <span className={styles.authorPlace}>{formatPlace(review)}</span>
      </span>
      {rating(review)}
    </>
  );

  return (
    <section className={styles.section} aria-labelledby='reviews-heading'>
      <div className={styles.inner}>
        <header className={styles.header}>
          <h2 id='reviews-heading' className={styles.headline}>
            {t(headlineKey)}
          </h2>
        </header>

        <div
          className={styles.reviews}
          onScroll={event => {
            if (
              !rowScrolled.current &&
              event.currentTarget.scrollLeft > ROW_SCROLLED_PX
            ) {
              rowScrolled.current = true;
              trackDemoInteraction('reviews', 'row_scroll');
            }
          }}>
          <figure className={styles.lead}>
            <blockquote className={styles.punch}>
              <p className={styles.punchLine}>{last}</p>
              {before !== '' && <p className={styles.punchRest}>{before}</p>}
            </blockquote>
            <figcaption className={styles.foot}>{author(lead)}</figcaption>
          </figure>

          {rest.length > 0 && (
            <>
              <ButtonAtom
                variant='outlined'
                size='md'
                className={styles.moreButton}
                aria-expanded={moreOpen}
                aria-controls={moreId}
                onClick={() => {
                  if (!moreOpen) {
                    trackDemoInteraction('reviews', 'expand');
                  }
                  setMoreOpen(open => !open);
                }}>
                {moreOpen
                  ? t('lessReviews')
                  : t('moreReviews', { count: rest.length })}
              </ButtonAtom>
              <DisclosurePanelAtom id={moreId} open={moreOpen} from='md'>
                <ul className={styles.rest}>
                  {rest.map(review => (
                    <li key={review.id} className={styles.card}>
                      <blockquote className={styles.quote}>
                        {t(review.quoteKey)}
                      </blockquote>
                      <div className={styles.foot}>{author(review)}</div>
                    </li>
                  ))}
                </ul>
              </DisclosurePanelAtom>
            </>
          )}
        </div>

        <p className={styles.consentNote}>{t('consentNote')}</p>
      </div>
    </section>
  );
}

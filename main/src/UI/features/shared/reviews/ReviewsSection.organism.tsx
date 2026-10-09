import { useTranslations } from 'next-intl';
import { EyebrowAtom } from '../../../components/Eyebrow/Eyebrow.atom';
import type { BetaReview } from './ReviewsData';
import styles from './ReviewsSection.module.css';

interface ReviewsSectionProps {
  reviews: ReadonlyArray<BetaReview>;
  /** Leaf keys under i18n namespace `static.reviews`. */
  eyebrowKey?: string;
  headlineKey?: string;
  /**
   * Wymusza konkretną opinię zestawu jako hero pull-quote — gdy automat
   * „najdłuższa opinia" wybiera głos niepasujący do kontekstu strony
   * (np. solo-stylistka pod nagłówkiem „Co mówią salony"). Id spoza
   * `reviews` lub brak propa = fallback na automat (zachowanie jak dotąd).
   * Hero + chór = nadal CAŁY zestaw, więc JSON-LD `reviewCount` bez zmian.
   */
  heroReviewId?: BetaReview['id'];
}

const RATING_SCALE = [1, 2, 3, 4, 5] as const;

/**
 * Znak oceny = płytka paznokcia: kopuła u góry, lekkie zwężenie ku skórce,
 * miękki dół. Głos ownera S95 (2026-08-19) na `/dev/playground`, forma 1:1.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Ocena recenzji NIE wraca jako gwiazdka i nie ma wracać. Sweep „zero ozdobnych
 * gwiazdek" (2026-08-18) celował w DEKORACJĘ i zdjął przy okazji ten znak, po
 * którym został techniczny napis kapitalikami; owner przywrócił ocenę pod
 * warunkiem własnego znaku. Michelin liczy w makaronikach, my liczymy w
 * paznokciach. Ratchet `audit:no-sparkle` dalej blokuje StarIcon/Sparkle/
 * 4-ramienne path/⭐ i tego znaku nie dotyczy.
 */
const NAIL_PATH =
  'M6 1.3c2.4 0 3.9 1.9 3.9 4.9l-.35 8.3c-.1 2.4-1.4 4.2-3.55 4.2s-3.45-1.8-3.55-4.2L2.1 6.2C2.1 3.2 3.6 1.3 6 1.3Z';

function formatPlace(review: BetaReview): string {
  return review.salon ? `${review.salon}, ${review.city}` : review.city;
}

/**
 * Social-proof section — hero-quote + chór (wariant B z głosowania ownera).
 * Najbogatsza (najdłuższa) opinia zestawu jako duży serif pull-quote z gold
 * cudzysłowem; pozostałe opinie równym chórem mniejszych bloków pod pełnym
 * hairline. Ta sama `reviews` tablica zasila JSON-LD `attachReviews()` na
 * stronie (hero + chór = całość zestawu), więc widoczna liczba ==
 * `reviewCount` w `AggregateRating`.
 */
export function ReviewsSectionOrganism({
  reviews,
  eyebrowKey = 'sectionEyebrow',
  headlineKey = 'stylistsHeadline',
  heroReviewId,
}: ReviewsSectionProps) {
  const t = useTranslations('static.reviews');

  /* Znaki są `aria-hidden` — całą ocenę niesie `aria-label` kontenera. */
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

  /* Hero: jawnie wskazana opinia (`heroReviewId`, o ile jest w zestawie),
     a bez wskazania — najdłuższa (najbogatsza treściowo) opinia zestawu:
     wybór deterministyczny per locale, działa dla każdego per-page zestawu
     bez hardkodowania konkretnej opinii. */
  const pinnedHero = reviews.find(review => review.id === heroReviewId);
  const hero =
    pinnedHero ??
    reviews.reduce(
      (best, review) =>
        t(review.quoteKey).length > t(best.quoteKey).length ? review : best,
      first
    );
  const choir = reviews.filter(review => review.id !== hero.id);

  return (
    <section className={styles.section} aria-labelledby='reviews-heading'>
      <div className={styles.inner}>
        <header className={styles.header}>
          <EyebrowAtom as='p' variant='plain'>
            {t(eyebrowKey)}
          </EyebrowAtom>
          <h2 id='reviews-heading' className={styles.headline}>
            {t(headlineKey)}
          </h2>
        </header>

        <figure className={styles.hero}>
          {/* Wielki dekoracyjny gold cudzysłów — wariant B */}
          <span className={styles.heroMark} aria-hidden='true'>
            &ldquo;
          </span>
          <blockquote className={styles.heroQuote}>
            {t(hero.quoteKey)}
          </blockquote>
          <figcaption className={styles.heroFoot}>
            <span className={styles.authorMeta}>
              <cite className={styles.authorName}>{hero.authorName}</cite>
              <span className={styles.authorPlace}>{formatPlace(hero)}</span>
            </span>
            {rating(hero)}
          </figcaption>
        </figure>

        {choir.length > 0 && (
          <>
            <hr className={styles.rule} />
            <ul className={styles.choir}>
              {choir.map(review => (
                <li key={review.id} className={styles.choirItem}>
                  <blockquote className={styles.choirQuote}>
                    {t(review.quoteKey)}
                  </blockquote>
                  <div className={styles.choirFoot}>
                    <span className={styles.authorMeta}>
                      <cite className={styles.authorName}>
                        {review.authorName}
                      </cite>
                      <span className={styles.authorPlace}>
                        {formatPlace(review)}
                      </span>
                    </span>
                    {rating(review)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className={styles.consentNote}>{t('consentNote')}</p>
      </div>
    </section>
  );
}

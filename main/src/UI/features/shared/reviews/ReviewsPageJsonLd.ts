import { getLocaleBcp47 } from '@kernel/policies/seo.policy';
import type { IntlMessages } from '../../../../types/i18n';
import { resolveMsgKey } from '../../../../application/i18n/resolve-msg-key';
import type { BetaReview } from './ReviewsData';

/**
 * Review / AggregateRating JSON-LD builders.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Treść opinii (`reviewBody`) i imiona (`author.name`) idą do JSON-LD bez żadnego
 * escape pola, jak każda treść od s34: bezpieczeństwo bloku `<script>` zapewnia ujście
 * (`serializeJsonLd`, application/security), a escape encjami HTML zamieniałby polskie
 * cudzysłowy i `&` w dosłowne `&amp;` i rozjechałby tekst z wersją renderowaną przez
 * React w `ReviewsSection`.
 *
 * `AggregateRating` doczepiamy do encji `SoftwareApplication` (NIE Organization):
 * Google pokazuje self-serving review snippets tylko dla Product/SoftwareApplication.
 * `reviewCount` = liczba przekazanych opinii = liczba widocznych na stronie.
 */

const REVIEW_PREFIX = 'static.reviews.';

function buildReviewJsonLd(
  review: BetaReview,
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  return {
    '@type': 'Review',
    author: { '@type': 'Person', name: review.authorName },
    datePublished: review.datePublished,
    reviewRating: {
      '@type': 'Rating',
      ratingValue: review.rating,
      bestRating: 5,
      worstRating: 1,
    },
    reviewBody: resolveMsgKey(messages, REVIEW_PREFIX + review.quoteKey),
    inLanguage: getLocaleBcp47(locale),
  };
}

function buildAggregateRating(
  reviews: ReadonlyArray<BetaReview>
): Record<string, unknown> {
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  const average = sum / reviews.length;
  return {
    '@type': 'AggregateRating',
    ratingValue: average.toFixed(1),
    reviewCount: reviews.length,
    bestRating: 5,
    worstRating: 1,
  };
}

/**
 * Returns a copy of `softwareApp` enriched with `aggregateRating` + `review[]`
 * built from `reviews`. When `reviews` is empty the entity is returned
 * unchanged (no zero-count AggregateRating, no division by zero).
 */
export function attachReviews(
  softwareApp: Record<string, unknown>,
  reviews: ReadonlyArray<BetaReview>,
  messages: IntlMessages,
  locale: string
): Record<string, unknown> {
  if (reviews.length === 0) {
    return softwareApp;
  }
  return {
    ...softwareApp,
    aggregateRating: buildAggregateRating(reviews),
    review: reviews.map(r => buildReviewJsonLd(r, messages, locale)),
  };
}

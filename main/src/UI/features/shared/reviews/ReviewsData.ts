/**
 * Beta reviews — SSOT for the social-proof sections + Review/AggregateRating
 * JSON-LD across the public landing pages.
 *
 * Treść cytatów żyje w i18n (`static.reviews.<quoteKey>`, tłumaczona pl/en/de);
 * imię/miasto/salon to nazwy własne — NIE tłumaczone, trzymane tu jako stałe.
 * `datePublished` to metadane wymagane przez schema.org Review.
 *
 * KLUCZOWE (compliance): ta sama per-page tablica zasila JEDNOCZEŚNIE widoczny
 * `ReviewsSection` i `attachReviews()` w JSON-LD, więc `reviewCount` w
 * `AggregateRating` jest ZAWSZE równy liczbie opinii widocznych na stronie
 * (wymóg Google self-serving review policy). Nie rozłączać tych dwóch źródeł.
 */

export interface BetaReview {
  readonly id: string;
  readonly audience: 'stylist' | 'client';
  readonly authorName: string;
  readonly city: string;
  readonly salon?: string;
  readonly rating: 1 | 2 | 3 | 4 | 5;
  /** ISO 8601 (YYYY-MM-DD). */
  readonly datePublished: string;
  /** Leaf key under i18n namespace `static.reviews`. */
  readonly quoteKey: string;
  /** Wszystkie opinie z `Publikacja: tak` w SOCIAL_PROOF.md. */
  readonly consent: true;
}

/* ─── Stylist reviews ─── */

const S_MEMORY: BetaReview = {
  id: 'sMemory',
  audience: 'stylist',
  authorName: 'Ania K.',
  city: 'Warszawa',
  rating: 5,
  datePublished: '2026-04-08',
  quoteKey: 'sMemory',
  consent: true,
};

const S_QR: BetaReview = {
  id: 'sQr',
  audience: 'stylist',
  authorName: 'Magda W.',
  city: 'Poznań',
  rating: 4,
  datePublished: '2026-04-15',
  quoteKey: 'sQr',
  consent: true,
};

const S_FILTERS: BetaReview = {
  id: 'sFilters',
  audience: 'stylist',
  authorName: 'Justyna R.',
  city: 'Gdańsk',
  rating: 5,
  datePublished: '2026-03-30',
  quoteKey: 'sFilters',
  consent: true,
};

const S_SESSIONS: BetaReview = {
  id: 'sSessions',
  audience: 'stylist',
  authorName: 'Ewa S.',
  city: 'Kraków',
  rating: 5,
  datePublished: '2026-05-05',
  quoteKey: 'sSessions',
  consent: true,
};

const S_PRICE: BetaReview = {
  id: 'sPrice',
  audience: 'stylist',
  authorName: 'Kamila L.',
  city: 'Wrocław',
  rating: 4,
  datePublished: '2026-04-11',
  quoteKey: 'sPrice',
  consent: true,
};

const S_AESTHETIC: BetaReview = {
  id: 'sAesthetic',
  audience: 'stylist',
  authorName: 'Beata M.',
  city: 'Sosnowiec',
  rating: 4,
  datePublished: '2026-05-12',
  quoteKey: 'sAesthetic',
  consent: true,
};

const S_WEB: BetaReview = {
  id: 'sWeb',
  audience: 'stylist',
  authorName: 'Iza D.',
  city: 'Katowice',
  salon: 'Nails & Coffee',
  rating: 4,
  datePublished: '2026-03-24',
  quoteKey: 'sWeb',
  consent: true,
};

/* ─── Client reviews ─── */

const C_NOACCOUNT: BetaReview = {
  id: 'cNoAccount',
  audience: 'client',
  authorName: 'Kasia',
  city: 'Kraków',
  rating: 5,
  datePublished: '2026-04-03',
  quoteKey: 'cNoAccount',
  consent: true,
};

const C_MEMORY: BetaReview = {
  id: 'cMemory',
  audience: 'client',
  authorName: 'Marta G.',
  city: 'Warszawa',
  rating: 5,
  datePublished: '2026-04-18',
  quoteKey: 'cMemory',
  consent: true,
};

const C_PINTEREST: BetaReview = {
  id: 'cPinterest',
  audience: 'client',
  authorName: 'Ola W.',
  city: 'Gdańsk',
  rating: 4,
  datePublished: '2026-05-02',
  quoteKey: 'cPinterest',
  consent: true,
};

const C_SESSIONS: BetaReview = {
  id: 'cSessions',
  audience: 'client',
  authorName: 'Zuzanna',
  city: 'Poznań',
  rating: 5,
  datePublished: '2026-04-27',
  quoteKey: 'cSessions',
  consent: true,
};

const C_SHY: BetaReview = {
  id: 'cShy',
  audience: 'client',
  authorName: 'Ania M.',
  city: 'Wrocław',
  rating: 5,
  datePublished: '2026-05-09',
  quoteKey: 'cShy',
  consent: true,
};

const C_TIME: BetaReview = {
  id: 'cTime',
  audience: 'client',
  authorName: 'Magda T.',
  city: 'Łódź',
  rating: 4,
  datePublished: '2026-03-28',
  quoteKey: 'cTime',
  consent: true,
};

const C_INSTAGRAM: BetaReview = {
  id: 'cInstagram',
  audience: 'client',
  authorName: 'Kamila',
  city: 'Szczecin',
  rating: 5,
  datePublished: '2026-05-15',
  quoteKey: 'cInstagram',
  consent: true,
};

/* ─── Master sets ─── */

export const STYLIST_REVIEWS: readonly BetaReview[] = [
  S_MEMORY,
  S_QR,
  S_FILTERS,
  S_SESSIONS,
  S_PRICE,
  S_AESTHETIC,
  S_WEB,
];

export const CLIENT_REVIEWS: readonly BetaReview[] = [
  C_NOACCOUNT,
  C_MEMORY,
  C_PINTEREST,
  C_SESSIONS,
  C_SHY,
  C_TIME,
  C_INSTAGRAM,
];

/* ─── Per-page selections (drive BOTH the visible section and the JSON-LD) ─── */

export const STUDIO_REVIEWS: readonly BetaReview[] = [S_QR, S_SESSIONS];
export const PRICING_REVIEWS: readonly BetaReview[] = [S_PRICE, S_MEMORY];
export const HOME_REVIEWS: readonly BetaReview[] = [
  S_FILTERS,
  S_MEMORY,
  C_INSTAGRAM,
  C_PINTEREST,
];
export const GET_APP_REVIEWS: readonly BetaReview[] = [
  C_NOACCOUNT,
  C_INSTAGRAM,
  S_MEMORY,
  S_QR,
];

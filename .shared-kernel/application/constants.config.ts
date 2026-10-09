/**
 * Time unit conversions — SINGLE SOURCE OF TRUTH for `N * <unit>` arithmetic.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wszystkie literały `24 * 60 * 60 * 1000` / `60 * 60 * 1000` rozsiane po web-1
 * (TTL-e tokenów, throttle interceptorów, okna anomalii, dunning) zostały scalone
 * tutaj. Konsumenci budują własne wielokrotności z tych baz, np. `7 * TIME.MS_PER_DAY`,
 * `WINDOW_HOURS * TIME.MS_PER_HOUR` — wartość pozostaje DOKŁADNIE ta sama, znika tylko
 * powtórzona magic-arytmetyka. Guard: `tests/audit/time-literals.sh` blokuje powrót
 * surowych literałów poza tym plikiem. NIE dodawaj tu domenowych okien (90d recovery,
 * 30000ms HTTP timeout) — to osobne, intencjonalne decyzje, nie konwersje jednostek.
 */
export const TIME = {
  MS_PER_MINUTE: 60_000,
  MS_PER_HOUR: 3_600_000,
  MS_PER_DAY: 86_400_000,
  SECONDS_PER_DAY: 86_400,
} as const;

/**
 * Exponential-backoff retry defaults — canonical base used by transient-failure
 * retry loops (email delivery, Stripe API, moderation email).
 *
 * DECISION (nie usuwaj tego komentarza):
 * To jest KANONICZNY base (1000ms) dla retry-loopów na transient errorach. NIE jest
 * to globalny override dla każdego retry: warstwy z celowo krótszym oknem (np.
 * Cloudinary asset cleanup / magic-link adapter = 500ms, bo działają w ciasniejszym
 * budżecie HTTP/tx) ZACHOWUJĄ swój local const i swoją wartość — różne wartości
 * pozostają różne, NIE scalamy ich do jednej stałej (anty-pattern: fałszywy SSOT na
 * dwóch niezależnych decyzjach). Importuj RETRY.BASE_DELAY_MS tylko tam, gdzie 1000ms
 * jest faktycznie tą samą decyzją.
 */
export const RETRY = {
  BASE_DELAY_MS: 1_000,
  MAX_ATTEMPTS: 3,
  // Email delivery retries fewer times than the general path: 2 attempts = 1 retry.
  EMAIL_MAX_ATTEMPTS: 2,
} as const;

/**
 * Prisma interactive-transaction tuning for Stripe webhook handlers.
 *
 * DECISION (nie usuwaj tego komentarza):
 * `maxWait`/`timeout` podniesione względem domyślnych (2s/5s). Pierwotnym powodem były
 * calle do Stripe wewnątrz transakcji; od S89 (D2-F1 domknięte) NIE MA ich tam ani jednego
 * — cały kontekst Stripe rozwiązuje `prefetchStripeEventContext` przed otwarciem transakcji,
 * a strażnik `audit:stripe-no-api-in-tx` tego pilnuje. Zapas ZOSTAJE, bo konsumuje go teraz
 * co innego: `acquireAdvisoryXactLock(customerId)` serializuje handlery per-konto, więc druga
 * transakcja tego samego klienta czeka pod zamkiem tyle, ile trwa pierwsza. NIE obniżaj tego
 * budżetu "skoro Stripe zniknął z transakcji" bez zmierzenia czasu oczekiwania pod lockiem.
 * SSOT na poziomie kernela, bo identyczna para żyła w dwóch miejscach
 * (`webhooks/stripe/index.ts` + janitor). Zmiana budżetu = jeden punkt.
 */
export const PRISMA_TX = {
  maxWait: 5_000,
  timeout: 25_000,
} as const;

export const STRIPE_CONFIG = {
  API_TIMEOUT_MS: 20000,
  /**
   * Stripe API version pinned to a known-good release.
   *
   * DECISION (nie usuwaj tego komentarza):
   * Pinning the API version explicitly (vs. account default) guarantees consistent
   * payload shape across deploys. Centralized here (SSOT) so the Stripe SDK adapter
   * AND any future SDK consumers (e.g. billing portal, refunds) share one source.
   * Bump only after testing against the new shape — Stripe changelog details breaking changes.
   */
  API_VERSION: '2025-12-15.clover',
} as const;

export const HTTP_CLIENT_CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_REDIRECTS: 5,
  MAX_CONTENT_LENGTH_BYTES: 10 * 1024 * 1024, // 10MB
  /** Cloudinary SDK request timeout — 20s to bound hung requests during outages. */
  CLOUDINARY_TIMEOUT_MS: 20000,
} as const;

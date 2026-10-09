/**
 * BRAND_CONFIG — single source of truth for Nailfolio brand identity.
 *
 * Name, domain, deep-link scheme, contact emails, social handles, native
 * package id. Consumers (JSON-LD, SEO meta, UI copy-in-TSX, contact surfaces)
 * import from here instead of hardcoding literals.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Transport-layer FROM addresses (SMTP) and env-configurable origins
 * (better-auth trustedOrigins, frontend URL fallbacks) are env-driven BY DESIGN
 * and are NOT collapsed into this config — `BRAND_CONFIG.email.*` are CONTACT
 * addresses surfaced in UI/JSON-LD, not the SMTP envelope sender. Do not merge
 * the two channels (FWE Wave A).
 */
export const BRAND_CONFIG = Object.freeze({
  name: 'Nailfolio',
  legalName: 'Nailfolio',
  domain: 'nailfolio.app',
  url: 'https://nailfolio.app',
  deepLinkScheme: 'nailfolio://',
  // Publiczna strona statusu (Better Stack, historia 90 dni). Własna subdomena
  // jest skonfigurowana po stronie dostawcy i w DNS — produkt linkuje
  // WYŁĄCZNIE tę wartość. Wewnętrzne `/status` (sonda SSR na
  // naszym backendzie) zostaje osobno: linkuje je strona błędu 500.
  statusUrl: 'https://status.nailfolio.app',
  // DECISION (nie usuwaj tego komentarza):
  // androidPackage MUST stay in sync with main/public/.well-known/assetlinks.json
  // (package_name) — that file is static JSON consumed by Android App Links
  // verification and cannot import this config. Change both together.
  androidPackage: 'com.nailfolio.app',
  email: Object.freeze({
    support: 'support@nailfolio.app',
    contact: 'kontakt@nailfolio.app',
    privacy: 'privacy@nailfolio.app',
  } as const),
  social: Object.freeze({
    twitterHandle: '@nailfolio_app',
    // Realny profil (zalozony przez ownera 2026-07-16): instagram.com/nailfolio.app
    instagram: 'nailfolio.app',
  } as const),
} as const);

import type { ValueOf } from '../../application/application.utils';

export const FEATURE_FLAG_KEYS = {
  BLOG_ENABLED: 'blog_enabled',
  EXPLORE_ENABLED: 'explore_enabled',
  SALON_STAFF_ENABLED: 'salon_staff_enabled',
  // SPE: backend-read kill-switch dla embedded Payment Element (default ON).
  STRIPE_EMBEDDED_CHECKOUT_ENABLED: 'stripe_embedded_checkout_enabled',
  // SPE: backend-read fallback na hosted Stripe Checkout (default OFF, swap-able surface).
  STRIPE_HOSTED_FALLBACK_ENABLED: 'stripe_hosted_fallback_enabled',
} as const;

export type FeatureFlagKey = ValueOf<typeof FEATURE_FLAG_KEYS>;

export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  // DECISION (nie usuwaj tego komentarza):
  // BLOG_ENABLED default = true (2026-09-23). The blog is public in prod (DB row
  // on since September 2026) and the DB row stays the runtime switch. The default
  // matters because it is what the server renders before the client fetches the
  // flags: with `false` the footer „Blog” link never reached the HTML, so crawlers
  // that do not run JS (ChatGPT, Bing) saw no internal link to the blog at all.
  // History: parked 2026-03-30 with the default `false` until posts were ready.
  [FEATURE_FLAG_KEYS.BLOG_ENABLED]: true,
  [FEATURE_FLAG_KEYS.EXPLORE_ENABLED]: false,
  // DECISION (nie usuwaj tego komentarza):
  // SALON_STAFF_ENABLED = WIRED kill-switch (default ON), nie reserved scaffold.
  // Konsumowana w obu warstwach: FRONT — route gate /app/salon/staff
  // (getFeatureFlagServerSide w getStaticProps, ISR-revalidated jak EXPLORE) + nav
  // link ukryty w getStylistSections; BACK — requireSalonStaffEnabled() w 4 handlerach
  // api/v1/salon/staff/** (po RBAC, przed operacja). Back-guard jest KRYTYCZNY: bez
  // niego front-gate to tylko UI-hide i flaga=false zostawia endpointy otwarte (IDOR
  // bypass). Default true = feature aktywny; admin moze go wylaczyc runtime (kill-switch)
  // i oba gate'y reaguja. NIE jest w PUBLIC_FEATURE_FLAG_KEYS — front-gate dziala przez
  // offline-fallback DEFAULT (=true), back-guard czyta live wartosc z getFeatureFlags().
  [FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED]: true,
  // SPE: embedded checkout default ON (cały sens migracji — native feel). Wyłączenie
  // runtime -> dispatcher spada na hosted_fallback (jeśli ten ON) lub odrzuca paid-flow.
  [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED]: true,
  // SPE: hosted fallback default OFF — włączany tylko gdy embedded ma awarię/blok.
  [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED]: false,
};

export type FeatureFlagCategory = 'ui' | 'backend' | 'experimental';

// SSOT kategorii flag dla admin UI (AdminFeatureFlagsPage) — zastepuje dawna
// substring-heurystyke po nazwie klucza. Nowa flaga bez wpisu tutaj = blad TS
// (Record<FeatureFlagKey, ...> wymusza kompletnosc); UI ma dodatkowo runtime
// fallback 'experimental' dla kluczy spoza kernela (np. stale wiersze w DB).
export const FEATURE_FLAG_CATEGORIES: Record<
  FeatureFlagKey,
  FeatureFlagCategory
> = {
  [FEATURE_FLAG_KEYS.BLOG_ENABLED]: 'ui',
  [FEATURE_FLAG_KEYS.EXPLORE_ENABLED]: 'experimental',
  [FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED]: 'backend',
  [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED]: 'backend',
  [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED]: 'backend',
};

export const FEATURE_FLAG_DESCRIPTIONS: Record<FeatureFlagKey, string> = {
  [FEATURE_FLAG_KEYS.BLOG_ENABLED]: 'Blog - MDX blog system, sitemap, RSS feed',
  [FEATURE_FLAG_KEYS.EXPLORE_ENABLED]:
    'Explore tab - discovery feed dla klientek (cold-start OFF)',
  [FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED]:
    'Salon staff management feature (kill-switch, default ON)',
  [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED]:
    'Stripe embedded Payment Element (native feel in-app, default ON)',
  [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED]:
    'Stripe hosted Checkout fallback (default OFF, awaria/blok embedded)',
};

// DECISION (nie usuwaj tego komentarza):
// Whitelist of flags exposed via the UNAUTHENTICATED public endpoint
// (GET_FEATURE_FLAGS_PUBLIC, wired into BASE_PERMISSIONS). Only flags consumed by
// public / anonymous-reachable UI belong here:
//   • BLOG_ENABLED    — PublicFooter (rendered on every marketing/LP page)
//   • EXPLORE_ENABLED — AppLayout + /app/explore (client discovery feed)
// SALON_STAFF_ENABLED is deliberately NOT here — it is read backend-side
// (getFeatureFlags() in the salon/staff handlers) and stays admin-only via
// ADMIN_GET_FEATURE_FLAGS; its front route gate relies on the offline DEFAULT, never
// on this public endpoint, so it must not leak to anonymous visitors. The public
// handler (getFeatureFlagsPublic_IO) filters its response to exactly these keys; the
// client hook (usePublicFeatureFlag) already tolerates a subset (FEATURE_FLAG_DEFAULTS
// fallback for any absent key).
export const PUBLIC_FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  FEATURE_FLAG_KEYS.BLOG_ENABLED,
  FEATURE_FLAG_KEYS.EXPLORE_ENABLED,
] as const;

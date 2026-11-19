import type { ValueOf } from '../../application/application.utils';

export const FEATURE_FLAG_KEYS = {
  BLOG_ENABLED: 'blog_enabled',
  EXPLORE_ENABLED: 'explore_enabled',
  SALON_STAFF_ENABLED: 'salon_staff_enabled',
  // SPE: backend-read kill-switch dla embedded Payment Element (default ON).
  STRIPE_EMBEDDED_CHECKOUT_ENABLED: 'stripe_embedded_checkout_enabled',
  // SPE: backend-read fallback na hosted Stripe Checkout (default OFF, swap-able surface).
  STRIPE_HOSTED_FALLBACK_ENABLED: 'stripe_hosted_fallback_enabled',
  INTERNATIONAL_BILLING_ENABLED: 'international_billing_enabled',
  STRIPE_AUTOMATIC_TAX_ENABLED: 'stripe_automatic_tax_enabled',
  CHECKOUT_ATTEMPTS_ENABLED: 'checkout_attempts_enabled',
  PROFILE_MESSAGING_ENABLED: 'profile_messaging_enabled',
  SESSION_ACCEPTANCE_ENABLED: 'session_acceptance_enabled',
  NOTIFICATION_OPEN_ENABLED: 'notification_open_enabled',
} as const;

export type FeatureFlagKey = ValueOf<typeof FEATURE_FLAG_KEYS>;

export const FEATURE_FLAG_DEFAULTS: Record<FeatureFlagKey, boolean> = {
  // DECISION: BLOG_ENABLED defaults to true. The blog is public in prod and the DB row stays the
  // runtime switch; the default matters because it is what the server renders before the client
  // fetches flags: with `false` the footer "Blog" link never reached the HTML, so crawlers that do not
  // run JS (ChatGPT, Bing) saw no internal link to the blog.
  [FEATURE_FLAG_KEYS.BLOG_ENABLED]: true,
  [FEATURE_FLAG_KEYS.EXPLORE_ENABLED]: false,
  // DECISION: SALON_STAFF_ENABLED is enforced by the BACK guard only: requireSalonStaffEnabled() in the salon
  // staff/team/invitation handlers (after RBAC, before the operation) reads the live value. Without it
  // flag=false would leave the endpoints open. The flag is not in PUBLIC_FEATURE_FLAG_KEYS (internal flag), so
  // the front gates (route getStaticProps, drawer section) resolve to the offline DEFAULT (true) and are inert
  // today; they only activate if a narrow public projection ever exposes it.
  [FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED]: true,
  // Embedded checkout default ON (the point of the migration: native feel). Switching it off at
  // runtime makes the dispatcher fall back to hosted_fallback (if that is ON) or reject the paid flow.
  [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED]: true,
  // Hosted fallback default OFF: enabled only when embedded checkout is broken or blocked.
  [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED]: false,
  [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED]: false,
  [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED]: false,
  // First rollout stays closed until old checkout writers have drained.
  [FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED]: false,
  [FEATURE_FLAG_KEYS.PROFILE_MESSAGING_ENABLED]: false,
  [FEATURE_FLAG_KEYS.SESSION_ACCEPTANCE_ENABLED]: false,
  [FEATURE_FLAG_KEYS.NOTIFICATION_OPEN_ENABLED]: false,
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
  [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED]: 'backend',
  [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED]: 'backend',
  [FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED]: 'backend',
  [FEATURE_FLAG_KEYS.PROFILE_MESSAGING_ENABLED]: 'ui',
  [FEATURE_FLAG_KEYS.SESSION_ACCEPTANCE_ENABLED]: 'ui',
  [FEATURE_FLAG_KEYS.NOTIFICATION_OPEN_ENABLED]: 'backend',
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
  [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED]:
    'Foreign-country purchases after confirmed Stripe Tax setup (default OFF)',
  [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED]:
    'Stripe Tax for new purchases after seller registrations are configured (default OFF)',
  [FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED]:
    'Durable checkout attempts; enable after migration and old-writer drain (default OFF)',
  [FEATURE_FLAG_KEYS.PROFILE_MESSAGING_ENABLED]:
    'Public profile contact entry; enable after compatible backend rollout',
  [FEATURE_FLAG_KEYS.SESSION_ACCEPTANCE_ENABLED]:
    'Inspiration acceptance entry; enable after compatible backend rollout',
  [FEATURE_FLAG_KEYS.NOTIFICATION_OPEN_ENABLED]:
    'Push opener URLs; enable only after the frontend opener is deployed',
};

// DECISION: whitelist of flags exposed by the UNAUTHENTICATED public endpoint
// (GET_FEATURE_FLAGS_PUBLIC); only flags read by anonymous-reachable UI belong here: BLOG_ENABLED
// (PublicFooter on every marketing page) and EXPLORE_ENABLED (AppLayout, /app/explore).
// SALON_STAFF_ENABLED is deliberately absent: it is read backend-side and stays admin-only via
// ADMIN_GET_FEATURE_FLAGS, its front route gate uses the offline DEFAULT, and it must not leak to
// anonymous visitors. getFeatureFlagsPublic_IO filters to exactly these keys; usePublicFeatureFlag
// falls back to FEATURE_FLAG_DEFAULTS for absent keys.
export const PUBLIC_FEATURE_FLAG_KEYS: readonly FeatureFlagKey[] = [
  FEATURE_FLAG_KEYS.BLOG_ENABLED,
  FEATURE_FLAG_KEYS.EXPLORE_ENABLED,
  FEATURE_FLAG_KEYS.PROFILE_MESSAGING_ENABLED,
  FEATURE_FLAG_KEYS.SESSION_ACCEPTANCE_ENABLED,
] as const;

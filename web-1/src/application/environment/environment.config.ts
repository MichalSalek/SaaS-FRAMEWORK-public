import {
  normalizeBool,
  normalizeString,
} from '@kernel/application/environment';
import { validateEnvSchema } from './env-schema';

const RAW_VARS = {
  FRONTEND_PUBLIC_DOMAIN: normalizeString(process.env.FRONTEND_PUBLIC_DOMAIN),
  FRONTEND_PUBLIC_PORT: normalizeString(process.env.FRONTEND_PUBLIC_PORT),
  CLOUDINARY_SECRET: normalizeString(process.env.CLOUDINARY_SECRET),
  CLOUDINARY_CLOUD_NAME: normalizeString(process.env.CLOUDINARY_CLOUD_NAME),
  CLOUDINARY_API_KEY: normalizeString(process.env.CLOUDINARY_API_KEY),
  NODE_ENV_MANUAL: normalizeString(process.env.NODE_ENV_MANUAL).toUpperCase(),
  INIT_BACKEND_DEBUG_MODE: normalizeBool(process.env.INIT_BACKEND_DEBUG_MODE),
  INIT_BACKEND_DEBUG_DB_MODE: normalizeBool(
    process.env.INIT_BACKEND_DEBUG_DB_MODE
  ),
  ENABLE_APP_LOGS_DB: normalizeBool(process.env.ENABLE_APP_LOGS_DB),
  SEO_INDEXING_ENABLED: normalizeBool(process.env.SEO_INDEXING_ENABLED),
  DATABASE_URL: normalizeString(process.env.DATABASE_URL),
  DATABASE_APP_LOGS_URL: normalizeString(process.env.DATABASE_APP_LOGS_URL),
  MASTER_ADMIN_EMAIL: normalizeString(process.env.MASTER_ADMIN_EMAIL),
  // Better Auth (auth SSOT)
  BETTER_AUTH_SECRET: normalizeString(process.env.BETTER_AUTH_SECRET),
  BETTER_AUTH_URL: normalizeString(process.env.BETTER_AUTH_URL),
  PUBLIC_URL: normalizeString(process.env.PUBLIC_URL),
  // Native deep-link login (magic-link + OAuth) cutover switch. Default false.
  // When TRUE: magic-link emails point at the FRONTEND (associated) origin so a
  // phone tap opens the native app (Universal/App Links), click-tracking is
  // disabled on the login email, and native-originated OAuth returns via the
  // nailfolio:// custom scheme. Flip to true ONLY once nailfolio.app is live +
  // /.well-known/ association files are reachable + the wrapper PROD_URL is
  // aligned. See native-wrapper deep-link cutover runbook.
  NATIVE_DEEPLINK_ENABLED: normalizeBool(process.env.NATIVE_DEEPLINK_ENABLED),
  EMAIL_UNSUBSCRIBE_SECRET: normalizeString(
    process.env.EMAIL_UNSUBSCRIBE_SECRET
  ),
  // D23 (run 25): HMAC secret for admin impersonation opaque backup tokens.
  // Signs the {ref_id, expires_at} payload so tampering / brute-force lookups fail.
  IMPERSONATION_HMAC_SECRET: normalizeString(
    process.env.IMPERSONATION_HMAC_SECRET
  ),
  // Apple provider (optional — Better Auth feature-flagged by presence)
  APPLE_APP_BUNDLE_IDENTIFIER: normalizeString(
    process.env.APPLE_APP_BUNDLE_IDENTIFIER
  ),
  // Providers
  GOOGLE_CLIENT_ID: normalizeString(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: normalizeString(process.env.GOOGLE_CLIENT_SECRET),
  APPLE_ID: normalizeString(process.env.APPLE_ID),
  APPLE_TEAM_ID: normalizeString(process.env.APPLE_TEAM_ID),
  APPLE_PRIVATE_KEY: normalizeString(process.env.APPLE_PRIVATE_KEY),
  APPLE_KEY_ID: normalizeString(process.env.APPLE_KEY_ID),
  // Mailgun
  MAILGUN_API_KEY: normalizeString(process.env.MAILGUN_API_KEY),
  MAILGUN_API_BASE_URL: normalizeString(process.env.MAILGUN_API_BASE_URL),
  MAILGUN_DOMAIN: normalizeString(process.env.MAILGUN_DOMAIN),
  FROM_EMAIL: normalizeString(process.env.FROM_EMAIL),
  MAILGUN_SMTP_HOST: normalizeString(process.env.MAILGUN_SMTP_HOST),
  MAILGUN_SMTP_PORT: normalizeString(process.env.MAILGUN_SMTP_PORT),
  MAILGUN_SMTP_LOGIN: normalizeString(process.env.MAILGUN_SMTP_LOGIN),
  MAILGUN_SMTP_PASSWORD: normalizeString(process.env.MAILGUN_SMTP_PASSWORD),
  // Resend (transactional email — primary gdy klucz obecny; Mailgun fallback)
  RESEND_API_KEY: normalizeString(process.env.RESEND_API_KEY),
  // Resend Audiences (newsletter broadcast list) — PEŁNY klucz (contacts+broadcasts),
  // ODRĘBNY od send-only RESEND_API_KEY (least-privilege: hot send-path zostaje send-only).
  // Feature-flagged BY PRESENCE: oba obecne = sync potwierdzonych subskrybentów do listy.
  RESEND_MARKETING_API_KEY: normalizeString(
    process.env.RESEND_MARKETING_API_KEY
  ),
  RESEND_AUDIENCE_ID: normalizeString(process.env.RESEND_AUDIENCE_ID),
  // GA4 Measurement Protocol — serwerowe zdarzenie `purchase` z webhooka Stripe.
  // Feature-flagged BY PRESENCE (para): oba ustawione = przychód leci do GA4,
  // brak któregokolwiek = cicha bezczynność. SERVER-ONLY, nigdy NEXT_PUBLIC_.
  GA4_MEASUREMENT_ID: normalizeString(process.env.GA4_MEASUREMENT_ID),
  GA4_API_SECRET: normalizeString(process.env.GA4_API_SECRET),
  // Stripe
  STRIPE_SECRET_KEY: normalizeString(process.env.STRIPE_SECRET_KEY),
  STRIPE_WEBHOOK_SECRET: normalizeString(process.env.STRIPE_WEBHOOK_SECRET),
  STRIPE_PORTAL_RETURN_URL:
    normalizeString(process.env.STRIPE_PORTAL_RETURN_URL) ||
    'http://localhost:3000/app',
  STRIPE_PORTAL_CONFIGURATION_ID: normalizeString(
    process.env.STRIPE_PORTAL_CONFIGURATION_ID
  ),
  // QA-only: opcjonalne ID kuponu stosowanego przy checkoucie na czas QA. Puste = normalna cena.
  // Czytany w account-embedded-checkout.
  STRIPE_TEST_COUPON_ID: normalizeString(process.env.STRIPE_TEST_COUPON_ID),
  // PostHog Error Tracking (server-side). Feature-flagged BY PRESENCE (jak Stripe/Resend):
  // klucz obecny + PRODUCTION = błędy/warny backendu (reportIssueBackend) idą do PostHog
  // ($exception + backend_warning), pusty = tylko lokalny EventLog (SSOT logów zostaje).
  // POSTHOG_PROJECT_KEY = publiczny phc_ ingestion key (ten sam co klient main
  // NEXT_PUBLIC_POSTHOG_KEY). NIE sekret (jawnie shipowany do przeglądarki),
  // ale przez ENV_VARS dla env-governance. POSTHOG_HOST = bezpośredni EU ingest (nie /ingest proxy,
  // które jest rewritem Next tylko dla przeglądarki). Guard prod-only w posthog-server.ts.
  POSTHOG_PROJECT_KEY: normalizeString(process.env.POSTHOG_PROJECT_KEY),
  POSTHOG_HOST: normalizeString(process.env.POSTHOG_HOST),
  // Better Stack + Neon control-plane monitoring. All feature-flagged by presence:
  // - project-scoped Neon key reads current project usage without issuing SQL,
  // - the Better Stack heartbeat reports healthy/failed quota checks,
  // - budget remains an operator cost guard even after a paid Neon upgrade.
  BETTERSTACK_NEON_QUOTA_HEARTBEAT_URL: normalizeString(
    process.env.BETTERSTACK_NEON_QUOTA_HEARTBEAT_URL
  ),
  NEON_MONITORING_API_KEY: normalizeString(process.env.NEON_MONITORING_API_KEY),
  NEON_MONITORING_PROJECT_ID: normalizeString(
    process.env.NEON_MONITORING_PROJECT_ID
  ),
  NEON_COMPUTE_BUDGET_CU_HOURS: normalizeString(
    process.env.NEON_COMPUTE_BUDGET_CU_HOURS
  ),
  // Cloudflare Turnstile (anti-bot, publiczny contact form). Feature-flag BY PRESENCE:
  // sekret obecny = server-side siteverify wymagane na contact-form, pusty = OFF
  // (dev/staging). Konsument: application/security/turnstile.verify.ts.
  TURNSTILE_SECRET_KEY: normalizeString(process.env.TURNSTILE_SECRET_KEY),
  // i18n locale/timezone are NOT governed here — the READONLY kernel i18n.config
  // reads process.env.DEFAULT_LOCALE / process.env.TIMEZONE directly (SSOT, build-time,
  // allowlisted in env-governance). The old DEFAULT_LOCALE/TIMEZONE RAW_VARS entries
  // were dead (ENV_VARS.X never read) — removed (do not re-add).
  // Internal S2S shared secret (dev-login defense-in-depth + track-crawler auth).
  // Resolved here so every reader goes through ENV_VARS (env-governance ratchet).
  INTERNAL_SHARED_SECRET: normalizeString(process.env.INTERNAL_SHARED_SECRET),
  // Trust-aware client-IP resolution (secure-by-default unset — see trust-aware-ip.ts).
  TRUSTED_EDGE: normalizeString(process.env.TRUSTED_EDGE),
  TRUSTED_PROXY_DEPTH: normalizeString(process.env.TRUSTED_PROXY_DEPTH),
  // Runtime / process knobs.
  PORT: normalizeString(process.env.PORT),
  // Smoke-test bootstrap toggle (read by smoke-tests-runner + admin-seeding).
  RUN_SMOKE_TESTS_ON_STARTUP: normalizeBool(
    process.env.RUN_SMOKE_TESTS_ON_STARTUP
  ),
  // Dev email sink (email-dev-sink.ts) — quota guard for Mailgun's daily request cap.
  // DEV_EMAIL_LIVE_BUDGET: how many real Mailgun sends per process in DEVELOPMENT
  // before the rest are stubbed (default 1 = one canary to verify Mailgun on boot).
  // DEV_EMAIL_FORCE_LIVE: bypass stubbing entirely (real dev sends). Both INERT in
  // STAGING/PRODUCTION — the sink only ever stubs when IS_DEVELOPMENT_ENV().
  DEV_EMAIL_LIVE_BUDGET: normalizeString(process.env.DEV_EMAIL_LIVE_BUDGET),
  DEV_EMAIL_FORCE_LIVE: normalizeBool(process.env.DEV_EMAIL_FORCE_LIVE),
} as const;

// BDX W1.2: env-schema is the SINGLE gatekeeper for web-1 (replaces kernel
// validateEnv, which treated every entry as unconditionally required and would
// hard-fail prod on optional integrations like Apple / Cloudinary / Stripe).
// validateEnv stays the gatekeeper for `main/` only (untouched).
validateEnvSchema(RAW_VARS);

export const ENV_VARS = RAW_VARS;

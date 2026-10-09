import {
  normalizeBool,
  normalizeString,
  validateEnv,
} from '@kernel/application/environment';

const REQUIRED_VARS = {
  NEXT_PUBLIC_HTTP_PROTOCOL: normalizeString(
    process.env.NEXT_PUBLIC_HTTP_PROTOCOL
  ),
  NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN: normalizeString(
    process.env.NEXT_PUBLIC_BACKEND_PUBLIC_DOMAIN
  ),
  NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: normalizeString(
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  ),
  NEXT_PUBLIC_NODE_ENV_MANUAL: normalizeString(
    process.env.NEXT_PUBLIC_NODE_ENV_MANUAL ??
      process.env.NODE_ENV ??
      'DEVELOPMENT'
  ).toUpperCase(),
  NEXT_PUBLIC_ENABLE_EVENT_LOG_DB: normalizeBool(
    process.env.NEXT_PUBLIC_ENABLE_EVENT_LOG_DB,
    false
  ),
  // Surfaces the Google/Apple social-login buttons on the login screen. Default
  // false (magic-link is the sole login path). Flip true ONLY once provider creds
  // are configured in the backend (GOOGLE_CLIENT_ID/SECRET, APPLE_*) and — for the
  // native app — the deep-link cutover is done; then visual-QA the buttons.
  NEXT_PUBLIC_OAUTH_ENABLED: normalizeBool(
    process.env.NEXT_PUBLIC_OAUTH_ENABLED,
    false
  ),
  // i18n
  NEXT_PUBLIC_DEFAULT_LOCALE: normalizeString(
    process.env.NEXT_PUBLIC_DEFAULT_LOCALE
  ),
  NEXT_PUBLIC_TIMEZONE: normalizeString(process.env.NEXT_PUBLIC_TIMEZONE),
  // SPE (W2): Stripe publishable key — front mints the custom Checkout Session
  // surface with `loadStripe(...)`. Publishable (pk_*) by design = client-safe,
  // NOT a secret (the secret/restricted keys live backend-side only). Present in
  // .env across all environments; soft-mode dev keeps the app booting if absent
  // (validateEnv warns once, payment surface degrades to hosted_fallback).
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: normalizeString(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ),
} as const;

validateEnv(REQUIRED_VARS, 'main');

// Port is optional — Render backends use standard HTTPS (443), no port needed
export const ENV_VARS = {
  ...REQUIRED_VARS,
  // Pre-launch SEO gate: brak/false => site-wide noindex. Launch: SEO_INDEXING_ENABLED=true.
  SEO_INDEXING_ENABLED: normalizeBool(process.env.SEO_INDEXING_ENABLED),
  NEXT_PUBLIC_BACKEND_PUBLIC_PORT: normalizeString(
    process.env.NEXT_PUBLIC_BACKEND_PUBLIC_PORT
  ),
} as const;

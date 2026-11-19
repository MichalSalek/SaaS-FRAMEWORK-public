/**
 * Analytics configuration — GA4 / GTM / Microsoft Clarity.
 *
 * IDs are injected via NEXT_PUBLIC_* env vars. When an ID is absent the tool is NOT loaded, so this
 * code is dormant until configured (no CSP impact).
 *
 * DECISION: GA4 is normally configured INSIDE the GTM container (one tag manager).
 * NEXT_PUBLIC_GA4_ID is only an ALTERNATIVE (direct gtag.js), loaded when GTM is not configured, to
 * avoid double counting. With GTM, leave NEXT_PUBLIC_GA4_ID empty.
 */
const POSTHOG_DEFAULT_API_HOST = '/ingest';

export const ANALYTICS_CONFIG = Object.freeze({
  /** PostHog project API key (public phc_...). PRIMARY product analytics. */
  POSTHOG_KEY: (process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '').trim(),
  /** Same-origin reverse-proxy path for PostHog ingest/static/flags. */
  POSTHOG_HOST:
    (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? POSTHOG_DEFAULT_API_HOST).trim() ||
    POSTHOG_DEFAULT_API_HOST,
  /** Google Tag Manager container id, e.g. "GTM-XXXXXXX". */
  GTM_ID: process.env.NEXT_PUBLIC_GTM_ID ?? '',
  /** GA4 measurement id, e.g. "G-XXXXXXXXXX" (alternative to GTM-managed GA4). */
  GA4_ID: process.env.NEXT_PUBLIC_GA4_ID ?? '',
  /** Microsoft Clarity project id. */
  CLARITY_ID: process.env.NEXT_PUBLIC_CLARITY_ID ?? '',
} as const);

export const isPosthogConfigured = (): boolean =>
  ANALYTICS_CONFIG.POSTHOG_KEY.length > 0;

/**
 * Error Tracking ($exception client + SSR) is PRODUCTION-only: otherwise QA errors on staging
 * would land in the SHARED PostHog project and falsely fire the „app errors" email alert.
 * Analytics (pageviews/replay/heatmap) stays env-agnostic (a separate opt-OUT product decision);
 * only error capture is gated. Client+server-safe: reads NEXT_PUBLIC_* (inlined at build),
 * consistent with web-1 IS_PRODUCTION_ENV(). SSOT of the gate for PostHogProvider /
 * ErrorBoundary / posthog-server.
 */
export const isPosthogErrorTrackingEnabled = (): boolean =>
  isPosthogConfigured() &&
  (process.env.NEXT_PUBLIC_NODE_ENV_MANUAL ?? '').trim().toUpperCase() ===
    'PRODUCTION';
export const isGtmConfigured = (): boolean =>
  ANALYTICS_CONFIG.GTM_ID.length > 0;
export const isGa4Configured = (): boolean =>
  ANALYTICS_CONFIG.GA4_ID.length > 0;
export const isClarityConfigured = (): boolean =>
  ANALYTICS_CONFIG.CLARITY_ID.length > 0;

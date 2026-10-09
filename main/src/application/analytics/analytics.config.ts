/**
 * Analytics configuration — GA4 / GTM / Microsoft Clarity.
 *
 * IDs are injected via NEXT_PUBLIC_* env vars. When an ID is absent the tool is
 * NOT loaded — so this code is dormant until configured (no CSP impact).
 *
 * DECISION (nie usuwaj): GA4 jest normalnie konfigurowane WEWNĄTRZ kontenera GTM
 * (zalecane — jeden tag manager). NEXT_PUBLIC_GA4_ID jest wspierane jako
 * ALTERNATYWA (bezpośredni gtag.js) i ładowane TYLKO gdy GTM jest nieskonfigurowany,
 * by uniknąć podwójnego zliczania. Używając GTM → zostaw NEXT_PUBLIC_GA4_ID puste.
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
  /** GA4 measurement id, e.g. "G-XXXXXXXXXX" (alternatywa do GTM-managed GA4). */
  GA4_ID: process.env.NEXT_PUBLIC_GA4_ID ?? '',
  /** Microsoft Clarity project id. */
  CLARITY_ID: process.env.NEXT_PUBLIC_CLARITY_ID ?? '',
} as const);

export const isPosthogConfigured = (): boolean =>
  ANALYTICS_CONFIG.POSTHOG_KEY.length > 0;

/**
 * Error Tracking ($exception client + SSR) jest PRODUCTION-only — inaczej błędy z
 * QA na stagingu trafiłyby do WSPÓŁDZIELONEGO projektu PostHog i fałszywie odpaliły
 * alert emailowy „błędy aplikacji". Analityka (pageviews/replay/heatmap) zostaje
 * env-agnostyczna — gate'ujemy TYLKO error-capture.
 * Client+server-safe: czyta NEXT_PUBLIC_* (inline przy buildzie), spójne z web-1
 * IS_PRODUCTION_ENV(). SSOT gate'u dla PostHogProvider / ErrorBoundary / posthog-server.
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

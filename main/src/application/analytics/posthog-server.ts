import { PostHog } from 'posthog-node';
import {
  ANALYTICS_CONFIG,
  isPosthogErrorTrackingEnabled,
} from './analytics.config';

// Serwerowy klient PostHog dla `main` (frontend SSR) — łapie UNCAUGHT errory z
// getServerSideProps / render-serwera przez Next `onRequestError` (instrumentation.ts).
// Klient (posthog-js) pokrywa błędy w przeglądarce; TO pokrywa serwerową stronę SSR.
//
// Gate = isPosthogErrorTrackingEnabled (klucz obecny + PRODUCTION) — spójnie z web-1
// (IS_PRODUCTION_ENV). Dev/staging => no-op: staging błędy SSR NIE trafiają do
// współdzielonego projektu ani nie odpalają alertu (analityka na stagingu zostaje
// osobno, gate dotyczy tylko error-capture). Host = BEZPOŚREDNI EU ingest (NIE ANALYTICS_CONFIG.
// POSTHOG_HOST = '/ingest', który jest rewritem Next tylko dla przeglądarki — node
// nie umie strzelić do relatywnej ścieżki). flushAt:1 = wyślij od razu (SSR błędy
// rzadkie, proces może być ubity redeployem).

const DIRECT_POSTHOG_HOST = 'https://eu.i.posthog.com';

let client: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
  if (!isPosthogErrorTrackingEnabled()) {
    return null;
  }
  if (!client) {
    client = new PostHog(ANALYTICS_CONFIG.POSTHOG_KEY, {
      host: DIRECT_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

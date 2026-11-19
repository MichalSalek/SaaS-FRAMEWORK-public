import { PostHog } from 'posthog-node';
import {
  ANALYTICS_CONFIG,
  isPosthogErrorTrackingEnabled,
} from './analytics.config';

// Server-side PostHog client for `main` (frontend SSR): catches UNCAUGHT errors from
// getServerSideProps / server render via Next `onRequestError` (instrumentation.ts).
// The client (posthog-js) covers browser errors; THIS covers the SSR side.
//
// Gate = isPosthogErrorTrackingEnabled (key present + PRODUCTION), consistent with web-1
// (IS_PRODUCTION_ENV). Dev/staging => no-op: staging SSR errors do NOT reach the shared project
// or fire the alert (staging analytics stays separate; the gate covers only error capture).
// Host = the DIRECT EU ingest (NOT ANALYTICS_CONFIG.POSTHOG_HOST = '/ingest', a Next rewrite for
// the browser only; node cannot call a relative path). flushAt:1 = send at once (SSR errors are
// rare and the process may be killed by a redeploy).

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

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import {
  ANALYTICS_CONFIG,
  isPosthogConfigured,
  isPosthogErrorTrackingEnabled,
} from './analytics.config';
import type { CaptureResult, PostHog } from 'posthog-js';
import { attachPosthog, loadPosthogLibrary } from './posthog-client';
import { onTrackersMayStart } from './tracker-start';
import {
  isNonActionablePosthogException,
  POSTHOG_EXCEPTION_EVENT,
} from '../error-debugger/error-noise-filter';
import { captureAnalyticsUrlStateFromUrl } from './first-touch';
import { isInternalTrafficEnabled } from './internal-traffic';
import { resetDemoInteractionGuard } from './demo-events';
import { usePostHogReadinessStore } from './posthog-readiness.store';
import { linkAnalyticsSessions } from './session-link';
import {
  redactPosthogUrlProperties,
  redactSensitiveUrl,
} from './posthog-url-sanitizer';

type PostHogClient = PostHog;

const POSTHOG_DEFAULTS = '2026-05-30';
const POSTHOG_PERSISTENCE = 'localStorage+cookie';

/**
 * One noise threshold for both error sinks. `posthog-js` registers its own
 * global handlers, so without this hook a masked cross-origin „Script error."
 * (dropped on our side by error-noise-filter) still opened an active issue in PostHog
 * and ate the alert threshold; see the DECISION in application/error-debugger/error-noise-filter.ts.
 */
const dropNonActionableExceptions = (
  event: CaptureResult | null
): CaptureResult | null => {
  if (event?.event !== POSTHOG_EXCEPTION_EVENT) {
    return event;
  }
  const exceptionList = event.properties?.['$exception_list'] as
    readonly unknown[] | undefined;
  return isNonActionablePosthogException(exceptionList) ? null : event;
};

const sanitizeBeforeSend = (
  event: CaptureResult | null
): CaptureResult | null =>
  redactPosthogUrlProperties(dropNonActionableExceptions(event));

/** Waits for an idle moment, at most `timeoutMs`; returns a cancel. */
const scheduleIdle = (cb: () => void, timeoutMs: number): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(cb, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(cb, Math.min(timeoutMs, 1500));
  return () => window.clearTimeout(handle);
};

/** The recorder's first snapshot is its own long task: not in init's. */
const RECORDING_START_IDLE_TIMEOUT_MS = 3000;

interface LandingPage {
  href: string;
  pathname: string;
  at: Date;
}

/**
 * Where this document was opened, read when the app bundle runs. PostHog now
 * starts later (DECISION in tracker-start.ts); when an in-app navigation came
 * first, its automatic `$pageview` describes the second page and the landing
 * one would be missing from every funnel by landing page.
 */
const LANDING_PAGE: LandingPage | null =
  typeof window === 'undefined'
    ? null
    : {
        href: window.location.href,
        pathname: window.location.pathname,
        at: new Date(),
      };

const captureMissedLandingPageview = (posthog: PostHog): void => {
  if (
    LANDING_PAGE === null ||
    LANDING_PAGE.pathname === window.location.pathname
  ) {
    return;
  }
  posthog.capture(
    '$pageview',
    {
      $current_url: LANDING_PAGE.href,
      $pathname: LANDING_PAGE.pathname,
      landing_recovered: true,
    },
    { timestamp: LANDING_PAGE.at }
  );
};

/**
 * PostHogProvider — product analytics.
 *
 * An EXPLICIT refusal (analytics === false: "necessary only" or a granular switch-off) opts
 * capture out and stops replay. `reset()` is NOT called on refusal.
 */
export function PostHogProvider() {
  const router = useRouter();
  const consent = useCookieConsentStore(state => state.consent);
  const analyticsDenied = consent?.analytics === false;
  const posthogRef = useRef<PostHogClient | null>(null);

  // Once per page view (first render and every finished navigation). Keyed on
  // `asPath`, not on router events: only NavigationTransitionController may
  // subscribe to those (audit `navigation-controller-singleton`).
  useEffect(() => {
    resetDemoInteractionGuard();
    captureAnalyticsUrlStateFromUrl();
    // Own traffic is not measured (DECISION in internal-traffic.ts). The cookie
    // may have appeared since the last page view (an admin logged in): a
    // PostHog that is already running stops here.
    const activePosthog = posthogRef.current;
    if (activePosthog && isInternalTrafficEnabled()) {
      activePosthog.opt_out_capturing();
      activePosthog.stopSessionRecording();
    } else if (activePosthog) {
      linkAnalyticsSessions(activePosthog);
    }
  }, [router.asPath]);

  useEffect(() => {
    if (!isPosthogConfigured()) {
      return;
    }

    let cancelled = false;
    let cancelRecordingStart: (() => void) | undefined;

    const run = async (): Promise<void> => {
      const internal = isInternalTrafficEnabled();
      // Own traffic: PostHog is never initialised, so nothing is captured and
      // no session is recorded (DECISION in internal-traffic.ts).
      if (internal && !posthogRef.current) {
        return;
      }
      if (!posthogRef.current) {
        const posthog = await loadPosthogLibrary();

        if (cancelled) {
          return;
        }

        posthog.init(ANALYTICS_CONFIG.POSTHOG_KEY, {
          api_host: ANALYTICS_CONFIG.POSTHOG_HOST,
          ui_host: 'https://eu.posthog.com',
          defaults: POSTHOG_DEFAULTS,
          autocapture: true,
          // Error Tracking (client): auto-captures uncaught JS errors and rejected promises as
          // $exception (same event as the backend, one project). capture_console_errors:false
          // on purpose: console logs are noise (libraries, dev warnings); real crashes are caught
          // by unhandled_errors + ErrorBoundary. PRODUCTION-only
          // (isPosthogErrorTrackingEnabled): on staging analytics runs but error capture is OFF,
          // so QA errors do not trigger the prod alert. false = posthog-js registers no global
          // error handlers.
          capture_exceptions: isPosthogErrorTrackingEnabled()
            ? {
                capture_unhandled_errors: true,
                capture_unhandled_rejections: true,
                capture_console_errors: false,
              }
            : false,
          before_send: sanitizeBeforeSend,
          loaded: loadedPosthog => {
            // A device that used to be marked internal and is measured again
            // drops the old mark.
            loadedPosthog.unregister('traffic_type');
            // `loadedPosthog` is this same singleton, typed as its interface.
            captureMissedLandingPageview(posthog);
            // Calls made before init run now, in their order (posthog-client.ts).
            attachPosthog(posthog);
            usePostHogReadinessStore.getState().markReady();
            linkAnalyticsSessions(loadedPosthog);
          },
          capture_pageview: 'history_change',
          capture_pageleave: true,
          capture_dead_clicks: true,
          rageclick: true,
          enable_heatmaps: true,
          person_profiles: 'identified_only',
          opt_out_capturing_by_default: false,
          persistence: POSTHOG_PERSISTENCE,
          // No surveys exist in the project (checked 2026-10-18): without this
          // every first load fetched and ran surveys.js for nothing.
          disable_surveys: true,
          // The recorder starts on the next idle moment (below), so its first
          // full snapshot is not part of the init task.
          disable_session_recording: true,
          // Extensions (autocapture, heatmaps, dead clicks, web vitals, error
          // capture) initialise in 30 ms slices instead of one long task.
          // Documented as experimental and slated to become the default; an
          // SDK that drops the flag ignores it.
          __preview_deferred_init_extensions: true,
          session_recording: {
            maskAllInputs: true,
            maskCapturedNetworkRequestFn: request => {
              if (typeof request.name === 'string') {
                request.name = redactSensitiveUrl(request.name);
              }
              return request;
            },
          },
        });
        posthogRef.current = posthog;
        if (!analyticsDenied && !internal) {
          cancelRecordingStart = scheduleIdle(() => {
            if (!cancelled && !posthog.has_opted_out_capturing()) {
              posthog.startSessionRecording();
            }
          }, RECORDING_START_IDLE_TIMEOUT_MS);
        }
      }

      const activePosthog = posthogRef.current;

      if (analyticsDenied || internal) {
        // Explicit refusal or own traffic: stop collecting, stop the replay.
        // No reset(): keep what was collected before the refusal.
        activePosthog.opt_out_capturing();
        activePosthog.stopSessionRecording();
      } else if (activePosthog.has_opted_out_capturing()) {
        // Only on a RETURN from a refusal. Init with opt_out_capturing_by_default:false already
        // captures from the start, so an unconditional opt_in_capturing() would emit a $opt_in
        // event on every page load (noise + quota). captureEventName:false = no $opt_in.
        activePosthog.opt_in_capturing({ captureEventName: false });
        activePosthog.startSessionRecording();
      }
    };

    // Perf (LCP/TBT): the first init waits for the tracker start gate (DECISION in
    // tracker-start.ts).
    // DECISION: the deferral changes only WHEN init runs, not the semantics in the JSDoc above:
    // capture still starts on its own, and calls made before it wait in posthog-client.ts. On an
    // explicit consent toggle PostHog is already initialised, so we react at once.
    if (posthogRef.current) {
      void run();
      return () => {
        cancelled = true;
        cancelRecordingStart?.();
      };
    }

    const unsubscribe = onTrackersMayStart(() => {
      void run();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      cancelRecordingStart?.();
    };
  }, [analyticsDenied]);

  return null;
}

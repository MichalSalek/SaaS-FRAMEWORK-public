import { useEffect, useRef } from 'react';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import {
  ANALYTICS_CONFIG,
  isPosthogConfigured,
  isPosthogErrorTrackingEnabled,
} from './analytics.config';
import type { CaptureResult, PostHog } from 'posthog-js';
import {
  isNonActionablePosthogException,
  POSTHOG_EXCEPTION_EVENT,
} from '../error-debugger/error-noise-filter';

type PostHogClient = PostHog;

const POSTHOG_DEFAULTS = '2026-05-30';
const POSTHOG_PERSISTENCE = 'localStorage+cookie';

const SENSITIVE_URL_PARAM =
  /([?&](?:token|auth|code|state|email|phone|session|password|pass|secret|key|signature|sig)=)[^&#]+/gi;

const redactSensitiveUrl = (value: string): string =>
  value.replace(SENSITIVE_URL_PARAM, '$1[REDACTED]');

/**
 * Wspólny próg szumu dla obu sinków błędów. `posthog-js` rejestruje własne
 * globalne handlery, więc bez tego haka maskowany cross-origin „Script error."
 * (odsiewany po naszej stronie w error-noise-filter) i tak zakładał w PostHogu
 * aktywne issue i zjadał próg alertu — patrz DECISION w error-noise-filter.ts.
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

/**
 * Odracza `cb` do bezczynności przeglądarki (po LCP), z twardym fallbackiem
 * czasowym gdy `requestIdleCallback` niedostępny (starsze Safari). Zwraca funkcję
 * anulującą (cleanup Reacta). Timeout 3000 ms gwarantuje start analityki nawet na
 * stale zajętym wątku; setTimeout 1500 ms to konserwatywny idle-proxy.
 */
const scheduleIdle = (cb: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(cb, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(cb, 1500);
  return () => window.clearTimeout(handle);
};

/**
 * PostHogProvider — product analytics.
 *
 * JAWNE odrzucenie (kategoria analytics === false, tj. "tylko niezbędne" lub
 * granularne wyłączenie) opt-outuje capture i zatrzymuje replay. NIE wołamy
 * `reset()` przy odrzuceniu.
 */
export function PostHogProvider() {
  const consent = useCookieConsentStore(state => state.consent);
  const analyticsDenied = consent?.analytics === false;
  const posthogRef = useRef<PostHogClient | null>(null);

  useEffect(() => {
    if (!isPosthogConfigured()) {
      return;
    }

    let cancelled = false;

    const run = async (): Promise<void> => {
      if (!posthogRef.current) {
        const { default: posthog } = await import('posthog-js');

        if (cancelled) {
          return;
        }

        posthog.init(ANALYTICS_CONFIG.POSTHOG_KEY, {
          api_host: ANALYTICS_CONFIG.POSTHOG_HOST,
          ui_host: 'https://eu.posthog.com',
          defaults: POSTHOG_DEFAULTS,
          autocapture: true,
          // Error Tracking (klient): autoprzechwytywanie niezłapanych błędów JS +
          // odrzuconych promise → event $exception (ten sam co backend, jeden projekt).
          // capture_console_errors:false celowo — logi z konsoli to szum (biblioteki,
          // dev-warny), realne crashe łapią unhandled_errors + ErrorBoundary.
          // PRODUCTION-only (isPosthogErrorTrackingEnabled): na stagingu analityka
          // działa, ale error-capture OFF, by błędy QA nie odpaliły alertu prod. false
          // = posthog-js NIE rejestruje globalnych handlerów błędów.
          capture_exceptions: isPosthogErrorTrackingEnabled()
            ? {
                capture_unhandled_errors: true,
                capture_unhandled_rejections: true,
                capture_console_errors: false,
              }
            : false,
          before_send: dropNonActionableExceptions,
          capture_pageview: 'history_change',
          capture_pageleave: true,
          capture_dead_clicks: true,
          rageclick: true,
          enable_heatmaps: true,
          person_profiles: 'identified_only',
          opt_out_capturing_by_default: false,
          persistence: POSTHOG_PERSISTENCE,
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
      }

      const activePosthog = posthogRef.current;

      if (analyticsDenied) {
        // Jawne odrzucenie: wyłącz dalsze zbieranie, zatrzymaj replay.
        // Bez reset(): opt-out wystarcza, żeby zatrzymać zbieranie.
        activePosthog.opt_out_capturing();
        activePosthog.stopSessionRecording();
      } else if (activePosthog.has_opted_out_capturing()) {
        // Tylko przy POWROCIE z odrzucenia. Init z opt_out_capturing_by_default:false
        // już capturuje od startu, więc bezwarunkowe opt_in_capturing() wrzucałoby
        // event $opt_in co page-load (szum + quota). captureEventName:false = bez $opt_in.
        activePosthog.opt_in_capturing({ captureEventName: false });
        activePosthog.startSessionRecording();
      }
    };

    // Perf (LCP/forced-reflow): pierwszą inicjalizację PostHog odraczamy do idle
    // (po LCP). session_recording + autocapture czytają layout, a robione w oknie
    // malowania LCP powodowały forced reflow (posthog-recorder.js) i rywalizację o
    // main-thread. DECISION (nie usuwaj): deferral dotyczy WYŁĄCZNIE timingu initu,
    // NIE zmienia semantyki z JSDoc powyżej — capture nadal startuje sam
    // (tylko ~sekundę później). Przy JAWNYM toggle'u zgody PostHog jest już
    // zainicjalizowany, więc reagujemy natychmiast (bez odraczania).
    if (posthogRef.current) {
      void run();
      return () => {
        cancelled = true;
      };
    }

    const cancelIdle = scheduleIdle(() => {
      void run();
    });

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [analyticsDenied]);

  return null;
}

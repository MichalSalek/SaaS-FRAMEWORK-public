import Script from 'next/script';
import { useEffect, useState } from 'react';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import {
  ANALYTICS_CONFIG,
  isGtmConfigured,
  isGa4Configured,
  isClarityConfigured,
} from './analytics.config';
import { onTrackersMayStart } from './tracker-start';

/**
 * AnalyticsScripts: opt-OUT loader for GTM / GA4 / Microsoft Clarity.
 *
 * DECISION: opt-OUT model (Consent Mode default granted). The loader mounts from the first visit
 * and no banner choice (consent === null) counts as consent; only an EXPLICIT refusal of the
 * analytics category (consent.analytics === false) unmounts it. Without IDs in env the component
 * renders nothing (no CSP or privacy-policy impact).
 *
 * DECISION: the loader is the EXTERNAL self-hosted `/analytics-bootstrap.js`, never inline. The
 * production CSP (proxy.ts) is hash-only for inline scripts (SSG has no per-request nonce), so an
 * inline `<Script>` is blocked on every page but home. A same-origin `src` passes `'self'`; the
 * Google/Clarity scripts it injects pass the explicit host list in script-src (production has no
 * `'https:'`, so a new GTM vendor means adding its host there). IDs travel through `data-*`
 * attributes. PostHog loads separately (PostHogProvider).
 */
export function AnalyticsScripts() {
  const consent = useCookieConsentStore(state => state.consent);
  const analyticsDenied = consent?.analytics === false;
  // The loader waits for the tracker start gate (DECISION in tracker-start.ts).
  const [mayStart, setMayStart] = useState(false);

  useEffect(() => onTrackersMayStart(() => setMayStart(true)), []);

  // Opt-OUT: on an EXPLICIT refusal in the SAME session gtm.js/gtag.js is already running
  // (default granted), and removing the bootstrap tag does NOT stop a running GTM/GA4/Clarity.
  // Send a Consent Mode update 'denied' so tags stop collecting at once, not on the next
  // page load (PostHog opts out separately in PostHogProvider).
  useEffect(() => {
    if (!analyticsDenied) {
      return;
    }
    const w = window as unknown as {
      gtag?: (...args: unknown[]) => void;
      clarity?: (...args: unknown[]) => void;
    };
    if (typeof w.gtag === 'function') {
      w.gtag('consent', 'update', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      });
    }
    // Clarity got 'granted' from the inline consent default: an explicit
    // refusal withdraws it, so Clarity drops its cookies.
    if (typeof w.clarity === 'function') {
      w.clarity('consentv2', {
        ad_Storage: 'denied',
        analytics_Storage: 'denied',
      });
    }
  }, [analyticsDenied]);

  if (analyticsDenied || !mayStart) {
    return null;
  }

  const gtmActive = isGtmConfigured();
  // GA4 only when GTM is not configured (avoids double counting; GA4 normally lives in GTM).
  const ga4Active = !gtmActive && isGa4Configured();
  const clarityActive = isClarityConfigured();

  // Dormant: no ID configured -> do not render the bootstrap tag.
  if (!gtmActive && !ga4Active && !clarityActive) {
    return null;
  }

  return (
    <Script
      id='analytics-bootstrap'
      src='/analytics-bootstrap.js'
      // Perf (LCP/TBT): the tag renders only once the tracker start gate is
      // open (first interaction, page hidden, or `load` + quiet time + idle;
      // DECISION in tracker-start.ts), so it is injected right away from there.
      // The Consent Mode default is NOT set here: an inline <head> script sets
      // it as the first dataLayer entry (consent-default-script.ts).
      strategy='afterInteractive'
      data-gtm-id={gtmActive ? ANALYTICS_CONFIG.GTM_ID : ''}
      data-ga4-id={ga4Active ? ANALYTICS_CONFIG.GA4_ID : ''}
      data-clarity-id={clarityActive ? ANALYTICS_CONFIG.CLARITY_ID : ''}
    />
  );
}

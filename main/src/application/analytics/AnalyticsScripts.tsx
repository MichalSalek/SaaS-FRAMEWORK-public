import Script from 'next/script';
import { useEffect } from 'react';
import { useCookieConsentStore } from '../stores/cookieConsent.store';
import {
  ANALYTICS_CONFIG,
  isGtmConfigured,
  isGa4Configured,
  isClarityConfigured,
} from './analytics.config';

/**
 * AnalyticsScripts — loader for GTM / GA4 / Microsoft Clarity.
 *
 * Loader ładuje się na starcie (Consent Mode default „granted"); JAWNE
 * odrzucenie kategorii analytics (consent.analytics === false, tj. „tylko
 * niezbędne") ODMONTOWUJE loader.
 *
 * Dormant until configured: gdy brak ID w env, tag się nie renderuje — komponent
 * jest no-opem (bez wpływu na CSP).
 *
 * DECISION (nie usuwaj): loader jest EXTERNAL self-hosted
 * (`/analytics-bootstrap.js`), NIE inline. Produkcyjny CSP (proxy.ts) używa
 * hash-only script-src (SSG nie ma per-request nonce), więc inline
 * `<Script>{...}</Script>` był blokowany i zabijał GTM/GA4/Clarity. Zewnętrzny
 * `src` self-origin przechodzi przez `'self'`, a skrypty Google/Clarity, które
 * bootstrap wstrzykuje, idą z hostów dozwolonych w script-src. IDs przekazujemy
 * przez `data-*` (runtime, env-agnostic). PostHog ładowany osobno (dynamic import w bundlu, PostHogProvider).
 */
export function AnalyticsScripts() {
  const consent = useCookieConsentStore(state => state.consent);
  const analyticsDenied = consent?.analytics === false;

  // Przy JAWNYM odrzuceniu w TEJ SAMEJ sesji gtm.js/gtag.js może już działać:
  // usunięcie tagu bootstrapu NIE zatrzymuje uruchomionego GTM/GA4/Clarity. Wysyłamy Consent Mode update 'denied', żeby tagi przestały
  // zbierać natychmiast, a nie dopiero po następnym page-load (PostHog opt-outuje
  // osobno w PostHogProvider).
  useEffect(() => {
    if (!analyticsDenied) {
      return;
    }
    const w = window as unknown as {
      gtag?: (...args: unknown[]) => void;
    };
    if (typeof w.gtag === 'function') {
      w.gtag('consent', 'update', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      });
    }
  }, [analyticsDenied]);

  if (analyticsDenied) {
    return null;
  }

  const gtmActive = isGtmConfigured();
  // GA4 tylko gdy GTM nieskonfigurowany (anty-double-count; GA4 zwykle w GTM).
  const ga4Active = !gtmActive && isGa4Configured();
  const clarityActive = isClarityConfigured();

  // Dormant: żadne ID skonfigurowane → nie renderuj tagu bootstrapu.
  if (!gtmActive && !ga4Active && !clarityActive) {
    return null;
  }

  return (
    <Script
      id='analytics-bootstrap'
      src='/analytics-bootstrap.js'
      // Perf (LCP/TBT): lazyOnload — GTM/GA4/Clarity to czysty tracking (w tym
      // Clarity session-replay czytający layout), nie potrzebują afterInteractive.
      // Ładowanie w idle po `load` zdejmuje ciężki third-party JS ze ścieżki
      // krytycznej LCP. Consent Mode default + initial pageview nadal się wykonują
      // (tylko po malowaniu LCP).
      strategy='lazyOnload'
      data-gtm-id={gtmActive ? ANALYTICS_CONFIG.GTM_ID : ''}
      data-ga4-id={ga4Active ? ANALYTICS_CONFIG.GA4_ID : ''}
      data-clarity-id={clarityActive ? ANALYTICS_CONFIG.CLARITY_ID : ''}
    />
  );
}

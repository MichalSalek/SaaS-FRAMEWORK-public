/**
 * Analytics bootstrap — self-hosted loader for GTM / GA4 / Microsoft Clarity.
 *
 * DECISION: loaded as an EXTERNAL self-origin <script src="/analytics-bootstrap.js"> (allowed by
 * CSP script-src 'self'), never inline. The production CSP (proxy.ts) is hash-only because pages are
 * SSG with no per-request nonce, so an inline <Script> had no matching hash and was blocked on every
 * page (GTM, GA4 and Clarity were dead). Scripts injected from here pass through the measured host
 * list in script-src (proxy.ts; production has no 'https:').
 *
 * IDs przychodza przez data-* atrybuty tego <script> (runtime) — plik jest
 * statyczny i nie ma build-time env, wiec env-agnostic: ten sam plik dziala na
 * dev/preview/prod, gate'owanie robi AnalyticsScripts (renderuje tag tylko gdy
 * dane ID skonfigurowane). Consent Mode default (analytics 'granted', ads
 * 'denied') stawia inline skrypt w <head> PRZED tym plikiem
 * (consent-default-script.ts, DECISION nizej). Po JAWNYM odrzuceniu
 * AnalyticsScripts wysyla gtag consent update 'denied'.
 */
(function () {
  var search = window.location.search || '';
  var queryParts = search ? search.substring(1).split('&') : [];
  var keptQueryParts = [];
  var internalOverride = null;
  var queryIndex;

  for (queryIndex = 0; queryIndex < queryParts.length; queryIndex += 1) {
    var queryPart = queryParts[queryIndex];
    var separatorIndex = queryPart.indexOf('=');
    var queryName =
      separatorIndex === -1
        ? queryPart
        : queryPart.substring(0, separatorIndex);
    var queryValue =
      separatorIndex === -1 ? '' : queryPart.substring(separatorIndex + 1);

    if (queryName === 'nf_internal') {
      if (queryValue === '1' || queryValue === '0') {
        internalOverride = queryValue;
      }
    } else if (queryPart) {
      keptQueryParts.push(queryPart);
    }
  }

  if (internalOverride !== null) {
    if (internalOverride === '1') {
      document.cookie = 'nf_internal=1; Path=/; Max-Age=34560000; SameSite=Lax';
    } else {
      document.cookie = 'nf_internal=; Path=/; Max-Age=0; SameSite=Lax';
    }

    try {
      var cleanedSearch = keptQueryParts.length
        ? '?' + keptQueryParts.join('&')
        : '';
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + cleanedSearch + window.location.hash
      );
    } catch (error) {
      // A failed history cleanup must not prevent analytics bootstrap.
    }
  }

  var el =
    document.currentScript || document.getElementById('analytics-bootstrap');
  if (!el) {
    return;
  }

  var gtmId = (el.getAttribute('data-gtm-id') || '').trim();
  var ga4Id = (el.getAttribute('data-ga4-id') || '').trim();
  var clarityId = (el.getAttribute('data-clarity-id') || '').trim();

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  if (typeof window.gtag !== 'function') {
    window.gtag = gtag;
  }

  // DECISION: own traffic (cookie nf_internal=1) is not measured at all: with the cookie GTM, GA4
  // and Clarity do not load, and `dataLayer`/`gtag` stay as empty stubs so app calls do not throw.
  // PostHog has the same gate in PostHogProvider. Set it with `?nf_internal=1` (`?nf_internal=0`
  // clears it), a master admin session or impersonation. (owner 2026-10-10)
  if (/(?:^|;\s*)nf_internal=1(?:;|$)/.test(document.cookie || '')) {
    return;
  }

  // DECISION: the Consent Mode `default` is an INLINE script in <head>
  // (src/application/analytics/consent-default-script.ts) because it must be the FIRST dataLayer
  // entry: this loader starts behind tracker-start.ts, after the app has pushed events, so a default
  // set here landed behind them. The same inline sends Clarity's `consentv2` signal; without it
  // Clarity treats EEA visits as unconsented and every page is a new session.
  // What stays here: a fallback default when the inline did not run (e.g. blocked by CSP), and an
  // update to 'granted' when the inline found a stored refusal but this loader still renders
  // (AnalyticsScripts renders it only when analytics is NOT refused, i.e. she withdrew the refusal
  // during this visit). An explicit refusal in the banner sends 'denied' (AnalyticsScripts).
  var consentDefault = null;
  var layerIndex;
  for (layerIndex = 0; layerIndex < window.dataLayer.length; layerIndex += 1) {
    var layerEntry = window.dataLayer[layerIndex];
    if (
      layerEntry &&
      layerEntry[0] === 'consent' &&
      layerEntry[1] === 'default'
    ) {
      consentDefault = layerEntry[2] || {};
      break;
    }
  }

  window.clarity =
    window.clarity ||
    function () {
      (window.clarity.q = window.clarity.q || []).push(arguments);
    };
  var grantedConsent = {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  };
  if (consentDefault === null) {
    window.gtag('consent', 'default', grantedConsent);
  } else if (consentDefault.analytics_storage !== 'granted') {
    window.gtag('consent', 'update', grantedConsent);
  }
  if (
    consentDefault === null ||
    consentDefault.analytics_storage !== 'granted'
  ) {
    window.clarity('consentv2', {
      ad_Storage: 'denied',
      analytics_Storage: 'granted',
    });
  }

  // GTM XOR GA4 — GA4 tylko gdy GTM nieskonfigurowany (anty-double-count; mirror
  // isGa4Configured gate w AnalyticsScripts). Oba loadery to https:// external.
  if (gtmId) {
    window.dataLayer.push({
      'gtm.start': new Date().getTime(),
      event: 'gtm.js',
    });
    var gtmScript = document.createElement('script');
    gtmScript.async = true;
    gtmScript.src = 'https://www.googletagmanager.com/gtm.js?id=' + gtmId;
    document.head.appendChild(gtmScript);
  } else if (ga4Id) {
    var ga4Script = document.createElement('script');
    ga4Script.async = true;
    ga4Script.src = 'https://www.googletagmanager.com/gtag/js?id=' + ga4Id;
    document.head.appendChild(ga4Script);
    window.gtag('js', new Date());
    window.gtag('config', ga4Id);
  }

  if (clarityId) {
    (function (c, l, a, r, i) {
      c[a] =
        c[a] ||
        function () {
          (c[a].q = c[a].q || []).push(arguments);
        };
      var t = l.createElement(r);
      t.async = 1;
      t.src = 'https://www.clarity.ms/tag/' + i;
      var y = l.getElementsByTagName(r)[0];
      y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', clarityId);
  }
})();

/**
 * Analytics bootstrap — self-hosted loader for GTM / GA4 / Microsoft Clarity.
 *
 * DECISION (nie usuwaj): ladowany jako EXTERNAL self-origin
 * <script src="/analytics-bootstrap.js"> (dozwolony przez CSP script-src 'self'),
 * NIE inline. Powod: produkcyjny CSP (proxy.ts) uzywa hash-only script-src bo
 * pages sa SSG (brak per-request nonce w build-time _document); inline
 * <Script>{...}</Script> nie mial matchujacego hasha i byl BLOKOWANY, przez co
 * GTM/GA4/Clarity byly martwe. Zewnetrzne skrypty wstrzykiwane STAD (gtm.js,
 * gtag.js, clarity/tag) sa https:// z hostow dozwolonych w script-src.
 *
 * IDs przychodza przez data-* atrybuty tego <script> (runtime) — plik jest
 * statyczny i nie ma build-time env, wiec env-agnostic: ten sam plik dziala na
 * dev/preview/prod, gate'owanie robi AnalyticsScripts (renderuje tag tylko gdy
 * dane ID skonfigurowane). Consent Mode default = analytics 'granted', ads
 * 'denied'. Po JAWNYM odrzuceniu AnalyticsScripts wysyla gtag consent update
 * 'denied' na juz-zaladowanym window.gtag.
 */
(function () {
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

  // Consent Mode default — analytics granted, ads denied (nie robimy reklam).
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });

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

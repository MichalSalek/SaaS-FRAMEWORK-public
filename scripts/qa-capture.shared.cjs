/**
 * Wspólny rdzeń obu screenshotterów QA (qa-screenshot.cjs = quick-login-tile,
 * qa-authed-screenshot.cjs = token-inject). Powstał, bo siostry ROZJECHAŁY SIĘ
 * w przygotowaniu strony i każda miała inny zestaw braków:
 *   • authed nie ukrywał TanStack Devtools (a to WŁAŚNIE /app, gdzie ten widget
 *     żyje), nie pre-akceptował cookie-bannera i nie robił pre-scrolla, więc
 *     next/image poniżej folda zostawał pustą ramką (census czytał to jako
 *     „pusty slot" — klasa z pamięci /ui),
 *   • nie-authed nie sprawdzał, czy quick-login faktycznie wszedł.
 * Rozjazd = ciche różnice jakości materiału, na którym census podejmuje decyzje.
 *
 * .cjs celowo (main/package.json ma "type":"module" — .js ładowałby się jako ESM).
 */

/** Skrypt startowy kontekstu: devtools-hide + content-visibility + cookie pre-akcept. */
async function applyCapturePrep(context, { themeSlug = 'rouge-papier' } = {}) {
  await context.addInitScript(slug => {
    const style = document.createElement('style');
    // TanStack Query Devtools (dev-only) poluje w rogu każdego screenshota i myli
    // census-agentów. content-visibility:auto (np. GalleryPhotoCard) pomija render
    // poza viewportem → fullPage łapał PUSTE karty (census S26 false-positive).
    style.textContent =
      '.tsqd-open-btn,.tsqd-parent-container{display:none!important}*{content-visibility:visible!important}';
    document.addEventListener('DOMContentLoaded', () =>
      document.head.appendChild(style)
    );

    // Cookie-banner zasłaniał treść w fullPage (census S22) — pre-akcept.
    try {
      localStorage.setItem(
        'cookie-consent-v1',
        JSON.stringify({
          state: { consent: { analytics: false, marketing: false } },
          version: 0,
        })
      );
    } catch {}

    // CSP-nonce gotcha (S22): na lokalnym `next start` CSP potrafi zablokować CAŁY
    // JS → ThemeContext nigdy nie ustawia data-theme → tokeny kolorów nie istnieją
    // i light wygląda „odarty z chrome". Fallback, gdy hydracja ich nie da.
    document.addEventListener('DOMContentLoaded', () => {
      const html = document.documentElement;
      if (!html.getAttribute('data-theme')) {
        html.setAttribute('data-theme', slug);
        html.setAttribute('data-mode', 'light');
      }
    });
  }, themeSlug);
}

/** Przewinięcie całej strony i powrót — budzi lazy-loading next/image przed fullPage. */
async function preScroll(page, { step = 700, pause = 110 } = {}) {
  await page
    .evaluate(
      async ({ step, pause }) => {
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise(r => setTimeout(r, pause));
        }
        window.scrollTo(0, 0);
      },
      { step, pause }
    )
    .catch(() => {});
}

/** Przełączenie kontekstu na dark (paleta zostaje — patrz DECISION niżej). */
async function switchToDark(page) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-mode', 'dark');
    // DECISION (nie usuwaj tego komentarza):
    // Selektor palety to [data-theme='rouge-papier'][data-mode='dark'] —
    // ustawienie data-theme='dark' go rozbija (tokeny lecą na fallbacki).
    // Slug palety ZOSTAJE, zmienia się wyłącznie data-mode.
    document.documentElement.setAttribute('data-theme', 'rouge-papier');
    document.documentElement.style.colorScheme = 'dark';
  });
}

/**
 * Czy strona faktycznie się otworzyła. Oba skrypty łykają błąd `goto`
 * (`waitUntil:'networkidle'` bywa nieosiągalne na stronach z pollingiem, a strona
 * i tak jest gotowa) — bez tej asercji utrata sesji albo martwa nawigacja kończyła
 * się screenshotem ekranu logowania i raportem „OK".
 * Świadomie NIE porównujemy pełnej ścieżki: legalne redirecty (locale-prefix,
 * desktop-bounce /app → /app/user/account) nie są awarią.
 * Zwraca komunikat błędu albo null, gdy wszystko gra.
 */
function landingProblem(page, requestedUrl) {
  const landed = page.url();
  if (!landed || landed === 'about:blank') {
    return `nawigacja nie doszła do skutku (url=${landed || 'brak'})`;
  }
  const wantsLogin = /\/user\/login/.test(requestedUrl);
  if (!wantsLogin && /\/user\/login/.test(landed)) {
    return `wylądowano na ekranie logowania (${landed}) — sesja nie została ustanowiona; screenshot byłby śmieciem`;
  }
  return null;
}

/**
 * Licznik wyników. Bez niego skrypty drukowały „FAIL <name>" i kończyły EXIT 0 —
 * wołający (skill /ui, agent) nie miał sygnału, że materiał jest bezwartościowy.
 */
function createReporter() {
  let failed = 0;
  return {
    ok(name) {
      console.log(`OK ${name}`);
    },
    fail(name, message) {
      failed += 1;
      console.log(`FAIL ${name}: ${message}`);
    },
    finish() {
      if (failed > 0) {
        console.error(`\n${failed} ekran(ów) nie zostało zrzuconych — patrz FAIL wyżej.`);
        process.exitCode = 1;
      }
    },
  };
}

module.exports = {
  applyCapturePrep,
  preScroll,
  switchToDark,
  landingProblem,
  createReporter,
};

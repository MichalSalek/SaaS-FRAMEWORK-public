#!/usr/bin/env node
/**
 * qa-theme-probe.cjs — MECHANICZNA bramka motywu „Jeden krem".
 *
 * PO CO OSOBNY SKRYPT, SKORO SĄ SCREENSHOTTERY:
 *   Screenshot odpowiada na pytanie „czy to ładne". Ten skrypt odpowiada na
 *   pytania, na które oko odpowiada ŹLE albo wcale:
 *     - ile kremowych PASÓW naprawdę jest na stronie (R2 mówi: najwyżej jeden),
 *     - czy dwa sąsiednie PASY (sekcje z własnym tłem, innym niż grunt strony)
 *       zlewają się w jedną plamę, czyli band przestał być bandem. UWAGA na
 *       zasięg tej metryki: w LIGHT --color-bg-main, --color-bg-paper,
 *       --color-bg-elevated i --color-surface-card to DOKŁADNIE ten sam
 *       #ffffff, więc pas na którymkolwiek z nich jest tam nieodróżnialny od
 *       gruntu i NIE liczy się jako płaszczyzna — realnie ta reguła pracuje
 *       więc w trybie ciemnym. To nie jest luka do zaklejenia: skoro pas
 *       renderuje się w light identycznie z tłem, to TAK go widzi użytkownik,
 *       a rozjazd wychodzi w ciemnym i tam jest raportowany. Sekcje leżące na
 *       gruncie strony nie są szwem w żadnym trybie — rozdziela je ODDECH,
 *       nie kreska (taste-owner: whitespace > hairlines),
 *     - czy strona przewija się w poziomie (3px overflow jest niewidoczne na
 *       screenshocie, a psuje mobile),
 *     - czy h1 nie jest pusty ANI nieobecny (klasa route-announcera, S60),
 *     - czy w konsoli nie ma błędów ORAZ pageerror (hydration mismatch NIE
 *       leci przez console.error — S56).
 *   Rundę robimy w OBU trybach i na dwóch szerokościach, bo wszystkie powyższe
 *   zależą od trybu albo od szerokości.
 *
 * ŹRÓDŁO TRAS: .shared-kernel/domain/routing/routing.config.ts (SSOT). Zgadywanie
 *   tras z głowy kończy się oceną ekranu 404 jako „broken ekran" (S27).
 *
 * ZASADA NACZELNA — ZERO CICHEGO ZIELONEGO (adwersaryjne review 2026-08-21):
 *   Bramka ma prawo zameldować sukces WYŁĄCZNIE nad ekranami, które FAKTYCZNIE
 *   zbadała. Każda ścieżka, która kiedyś kończyła się „nic nie zmierzyłem, więc
 *   czysto", jest dziś twardą awarią albo findingiem:
 *     - nie udało się pobrać tokenu persony  → finding + trasy do POMINIĘTYCH,
 *     - zero realnie wykonanych przebiegów   → finding (nigdy „✓ Zero znalezisk"),
 *     - wylądowaliśmy na innej stronie       → finding albo jawny POMINIĘTE,
 *     - brak <h1> w dokumencie               → finding (nie tylko pusty h1),
 *     - HTTP >= 400                          → finding (o ile nie jest to znany stan),
 *     - token kremu się nie rozwiązał        → TWARDA AWARIA (metryka R2 bez sensu),
 *     - pusta lista tras z SSOT              → TWARDA AWARIA (parser stracił marker).
 *
 * UŻYCIE:
 *   node scripts/qa-theme-probe.cjs [--public|--app|--admin|--all] [--json <plik>]
 *   BASE_URL=https://dev.example.com BACKEND_URL=https://api.dev.example.com \
 *     node scripts/qa-theme-probe.cjs --all
 *
 * DOMENA vs LOCALHOST: dev serwuje przez Caddy na subdomenie i to TAM należy
 *   robić QA — błędy konsoli na innym originie są mylące (origin-block HMR).
 *   Domyślne localhost ZOSTAJE (adres domeny jest per-maszyna, nie repo-wide),
 *   ale gołe uruchomienie krzyczy ostrzeżeniem, że wynik konsoli jest
 *   niemiarodajny.
 *
 * EXIT: 0 gdy zero znalezisk NAD NIEPUSTYM ZBIOREM przebiegów, 1 gdy cokolwiek
 *   wypadło albo gdy sonda nie zbadała niczego (bramka nadaje się do CI).
 */
const path = require('path');
const fs = require('fs');
const { applyCapturePrep, switchToDark, preScroll } = require('./qa-capture.shared.cjs');

let chromium;
try {
  ({ chromium } = require(path.resolve(__dirname, '../main/node_modules/playwright')));
} catch {
  try {
    ({ chromium } = require(path.resolve(__dirname, '../node_modules/playwright')));
  } catch {
    ({ chromium } = require('playwright'));
  }
}

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const BACKEND = (process.env.BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '');
if (!process.env.BASE_URL) {
  console.warn(
    '\n⚠  BASE_URL nieustawiony → celuję w ' + BASE + '.\n' +
      '   Dev serwuje przez Caddy na subdomenie i QA robi się TAM. Na localhoście\n' +
      '   błędy konsoli są NIEMIARODAJNE (origin-block HMR, inny origin dla API).\n' +
      '   Popraw: BASE_URL=https://dev.example.com BACKEND_URL=https://api.dev.example.com node scripts/qa-theme-probe.cjs …\n'
  );
}
const argv = process.argv.slice(2);
const jsonAt = argv.indexOf('--json');
const JSON_OUT = jsonAt !== -1 ? argv[jsonAt + 1] : null;
const scope = argv.find(a => /^--(public|app|admin|all)$/.test(a)) || '--all';

const ROUTING_SSOT = path.resolve(__dirname, '../.shared-kernel/domain/routing/routing.config.ts');

/** Twarda awaria — komunikat + exit 1. Sonda, która nie wie CO bada, nie ma prawa meldować. */
function hardFail(message) {
  console.error('\n╳ TWARDA AWARIA SONDY: ' + message);
  process.exit(1);
}

// ─── Trasy z SSOT ───────────────────────────────────────────────────────────
// Parser jest zależny od KSZTAŁTU pliku (marker `export const X = Object.freeze({`).
// Zmiana kształtu (nowa linia po `Object.freeze(`, przeniesienie rejestru do
// innego pliku) kiedyś dawała po cichu pustą listę → „ZBADANE: 0 przebiegów
// ✓ Zero znalezisk". Dziś każdy taki przypadek to twarda awaria ze wskazaniem
// pliku i markera.
function readRoutes() {
  if (!fs.existsSync(ROUTING_SSOT)) {
    hardFail(`brak SSOT tras: ${ROUTING_SSOT}`);
  }
  const src = fs.readFileSync(ROUTING_SSOT, 'utf8');
  const grab = name => {
    const marker = `export const ${name} = Object.freeze({`;
    const start = src.indexOf(marker);
    if (start === -1) {
      hardFail(`nie znalazłem markera \`${marker}\` w ${ROUTING_SSOT} — rejestr zmienił kształt albo się przeprowadził.`);
    }
    const end = src.indexOf('} as const);', start);
    if (end === -1) {
      hardFail(`marker \`${marker}\` znaleziony w ${ROUTING_SSOT}, ale brak domknięcia \`} as const);\` — parser nie wie, gdzie kończy się rejestr.`);
    }
    const out = [...src.slice(start, end).matchAll(/^\s*[A-Z0-9_]+:\s*'([^']+)'/gm)].map(m => m[1]);
    if (out.length === 0) {
      hardFail(`rejestr \`${name}\` w ${ROUTING_SSOT} sparsował się do ZERA tras — zmienił się zapis wartości (np. z apostrofów na backticki).`);
    }
    return out;
  };
  return { static: grab('ROUTES_FRONT_STATIC'), app: grab('ROUTES_FRONT_APP') };
}

// Trasy z [param] wymagają realnego id. Podmieniamy ze SEEDU demo (konta demo
// mają treść; konta smoke dają puste ekrany i fałszywe „content-findingi", S27).
// Brak podmianki = trasa POMIJANA z jawnym powodem, nigdy po cichu.
const PARAM_SAMPLES = JSON.parse(process.env.PARAM_SAMPLES || '{}');

// Kto ogląda którą trasę. Publiczne bez sesji; /app/admin jako admin; reszta
// /app jako stylistka z seedowaną treścią.
function personaFor(route) {
  if (!route.startsWith('/app')) return null;
  if (route.startsWith('/app/admin')) return 'admin';
  if (/client-profile|\/sessions|\/pairing/.test(route)) return 'clientdemo';
  return 'stylistpro';
}

const AUTH_EMAILS = {
  stylistpro: 'demo-stylist-main@example.com',
  clientdemo: 'demo-client-main@example.com',
  admin: 'test-admin-main@example.com',
};

async function fetchDevLoginToken(email) {
  const headers = { 'content-type': 'application/json', Origin: BASE };
  if (process.env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-secret'] = process.env.INTERNAL_SHARED_SECRET;
  }
  const res = await fetch(`${BACKEND}/api/auth/dev-login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email }),
  });
  const body = await res.text();
  if (body.includes('DEV_LOGIN_BLOCKED')) {
    throw new Error('DEV_LOGIN_BLOCKED — backend bez NODE_ENV_MANUAL=DEVELOPMENT lub zły sekret');
  }
  const token = res.headers.get('authorization');
  if (!token) throw new Error(`dev-login bez nagłówka authorization (HTTP ${res.status}) ${body.slice(0, 200)}`);
  return token;
}

// ─── Normalizacja adresów ───────────────────────────────────────────────────
// Porównując „gdzie deklarowaliśmy" z „gdzie faktycznie wylądowaliśmy" tolerujemy
// wyłącznie różnice BEZ ZNACZENIA: końcowy ukośnik i prefiks locale (standard
// Next.js `/en/for-stylists`). Query i hash odcinamy — `?tab=…` na TEJ SAMEJ
// ścieżce to nadal ta sama strona. Redirect na INNĄ ścieżkę nigdy nie przechodzi.
const LOCALE_PREFIX = /^\/(pl|en|de)(?=\/|$)/;
function normalizePath(u) {
  let p = String(u || '').split('#')[0].split('?')[0];
  p = p.replace(LOCALE_PREFIX, '');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

// ─── Oczekiwane bounce'y ────────────────────────────────────────────────────
// Trasa, która CELOWO przekierowuje. Nie jest defektem, ale nie jest też
// zbadana — ląduje w POMINIĘTYCH z powodem, a jej pomiar NIE jest wliczany
// (inaczej /app było oceniane trzy razy pod trzema cudzymi nazwami).
//   route  — trasa deklarowana (`prefix:true` = dowolna trasa pod tym prefiksem)
//   to     — dokąd wolno wylądować (znormalizowana ścieżka)
//   vp     — opcjonalnie: tylko na tej szerokości
const EXPECTED_BOUNCES = [
  {
    route: '/app/stylists',
    to: '/app/explore',
    why: 'czysty redirect BY DESIGN (pages/app/stylists/index.tsx: EXPLORE_ENABLED on → /app/explore); trasa nie ma własnego widoku',
  },
  {
    route: '/app/stylists',
    to: '/app',
    why: 'ten sam redirect przy EXPLORE_ENABLED off (kernelowy default „zaparkowane") → /app',
  },
  {
    route: '/app/user/activity',
    to: '/app/user/account',
    why: 'trwały redirect BY DESIGN (DECISION w pages/app/user/activity.tsx: timeline żyje jako zakładka konta ?tab=activity)',
  },
  {
    route: '/app/user/activate-stylist',
    to: '/app',
    why: 'persona sondy (demo-stylist) JUŻ jest stylistką → ActivateRolePage `alreadyHasRole` odsyła na panel; aktywacji nie da się obejrzeć z tego konta',
  },
  {
    route: '/app/favorites',
    to: '/app',
    why: 'Ulubione to trasa KLIENTKI; persona stylistki jest tu słusznie odsyłana przez RBAC (patrz KNOWN_NON_DEFECTS /app/favorites)',
  },
  {
    route: '/app',
    prefix: true,
    exceptPrefixes: ['/app/user/account', '/app/onboarding', '/app/checkout'],
    vp: '1280',
    to: '/get-app',
    why: 'desktop PREVIEW/PRODUCTION odsyla trasy PRODUKTU na /get-app (resolveDesktopBounceDecision); na devie sie nie odpala, ale przy BASE_URL=preview/prod owszem. exceptPrefixes: trasy KONTA i onboardingu maja na desktopie zostac (web-login-first, DECISION w useDesktopRedirectGuard) — gdyby ktoras z nich zaczela bouncowac, to REGRESJA, a nie oczekiwany bounce, wiec nie wolno jej tu wyciszyc prefiksem',
  },
];
function expectedBounce(route, landedPath, vpName) {
  const r = normalizePath(route);
  return EXPECTED_BOUNCES.find(b => {
    if (b.vp && b.vp !== vpName) return false;
    if (b.exceptPrefixes && b.exceptPrefixes.some(x => r === x || r.startsWith(x + '/'))) return false;
    const hit = b.prefix ? r === b.route || r.startsWith(b.route + '/') : r === b.route;
    return hit && normalizePath(landedPath) === b.to;
  });
}

// ─── Oczekiwany status HTTP ─────────────────────────────────────────────────
// `page.goto()` oddaje Response i jego status był kiedyś IGNOROWANY — strona
// 404/500, która wyrenderowała jakikolwiek h1, przechodziła jako czysty przebieg.
// Poniżej imienne wyjątki; wszystko inne >= 400 to finding.
const EXPECTED_HTTP = [
  {
    route: '/blog',
    status: 404,
    why: 'blog ZAPARKOWANY (BLOG_ENABLED=false) — 404 jest stanem docelowym; zweryfikowane na devie 2026-08-21 (curl /blog → 404)',
  },
];
function expectedHttp(route, status) {
  const r = normalizePath(route);
  return EXPECTED_HTTP.find(
    e => e.status === status && (r === e.route || r.startsWith(e.route + '/'))
  );
}

// ─── Trasy legalnie bez <h1> ────────────────────────────────────────────────
// CELOWO PUSTA. Sprawdzone 2026-08-21 na pełnym przebiegu --public (20 tras) i
// --app (18 zbadanych tras): KAŻDA trasa renderuje h1. Jedyny kandydat —
// /app/user/account/pay — pokazywał h1 === -1 wyłącznie dlatego, że stary kod
// ponawiał pomiar tylko dla h1 === 0; po rozszerzeniu ponowienia na h1 <= 0
// trasa oddaje h1 o długości 17 znaków, czyli był to WYŚCIG renderu, nie brak
// nagłówka. Wpis dodajemy wyłącznie, gdy trasa naprawdę nie może mieć h1,
// i zawsze z powodem.
const H1_OPTIONAL = [];
function h1Optional(route) {
  const r = normalizePath(route);
  return H1_OPTIONAL.find(e => r === e.route || r.startsWith(e.route + '/'));
}

// ─── Sonda w przeglądarce ───────────────────────────────────────────────────
// Świadomie mierzy, a nie ocenia: „wygląda blado" nie jest findingiem, a
// „dwa pasy kremu szerokości 100% viewportu" jest.
const PROBE = () => {
  const px = v => parseFloat(v) || 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;background:var(--color-bg-subtle)';
  document.body.appendChild(probe);
  const CREAM = getComputedStyle(probe).backgroundColor;
  probe.remove();

  const vw = document.documentElement.clientWidth;
  const all = [...document.querySelectorAll('body *')];
  // DECISION (nie usuwaj tego komentarza):
  // `visible()` ŚWIADOMIE ignoruje `opacity`. Element w trakcie animacji
  // `staggerIn` (stan FROM = opacity:0) MA być liczony — kierunek ryzyka jest tu
  // celowo ustawiony na fałszywy alarm, nie na przeoczenie. Nie „naprawiać".
  const visible = el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
  };

  const creamEls = all.filter(el => visible(el) && getComputedStyle(el).backgroundColor === CREAM);
  const describe = el =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : ''}`;
  // PAS = kremowa powierzchnia zajmująca co najmniej 60% szerokości ekranu.
  // Chip albo avatar na kremie to nie pas — R2 mówi o pasach, a od głosu
  // S98/A atomy i tak kremu nie noszą.
  const creamBands = creamEls.filter(el => el.getBoundingClientRect().width >= vw * 0.6);
  // Zagnieżdżone pasy (band w bandzie) liczymy raz.
  const topBands = creamBands.filter(el => !creamBands.some(o => o !== el && o.contains(el)));

  // Szew: dwie sąsiednie SEKCJE pełnej szerokości, to samo tło, zero linii między.
  // Tylko <section> i tylko na poziomie strony: pierwsza wersja liczyła też
  // wewnętrzne divy (nagłówek sekcji → jej własna siatka, dekoracyjna warstwa
  // → treść, thead → tbody) i tonęła w fałszywkach. Szew ma znaczenie wtedy,
  // gdy dwie SĄSIEDNIE SEKCJE strony zlewają się w jedną plamę.
  const sections = all.filter(el => {
    if (el.tagName !== 'SECTION' || !visible(el)) return false;
    if (el.parentElement && el.parentElement.closest('section')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= vw * 0.9 && r.height > 80;
  });
  // Grunt strony. Sekcja, która ma DOKŁADNIE ten kolor, nie deklaruje własnej
  // płaszczyzny — po prostu leży na tle strony.
  const ground = getComputedStyle(document.body).backgroundColor;
  const declaresPlane = cs =>
    cs.backgroundColor !== ground &&
    cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    cs.backgroundColor !== 'transparent';

  const seams = [];
  for (const el of sections) {
    const next = el.nextElementSibling;
    if (!next || !sections.includes(next)) continue;
    const a = getComputedStyle(el);
    const b = getComputedStyle(next);
    if (a.backgroundColor !== b.backgroundColor) continue;
    // KLUCZOWE zawężenie: dwie sekcje leżące na gruncie strony to NIE jest szew,
    // tylko kanoniczny rytm tego produktu — sekcje rozdziela ODDECH, nie linia
    // (taste-owner #33: „whitespace > hairlines", separacja spacingiem, linie
    // tylko na realnych granicach). Pierwsza wersja tej reguły tego nie
    // odróżniała i zgłaszała 14 „zlanych szwów" na czterech zdrowych stronach
    // (/compare, /get-app, /status, /help-center) — czyli strzelała w kanon.
    // Taka bramka uczy ignorowania własnych wyników i po kilku rundach jest
    // warta zero. Szew ma znaczenie wtedy, gdy dwie sąsiednie PŁASZCZYZNY
    // (pasy z własnym tłem: krem, atrament, papier nad gruntem) zlewają się
    // w jedną plamę — czyli band przestał być bandem.
    if (!declaresPlane(a) || !declaresPlane(b)) continue;
    const line =
      px(a.borderBottomWidth) > 0 || px(b.borderTopWidth) > 0 || a.borderBottomStyle === 'solid';
    if (!line) seams.push(`${describe(el)} → ${describe(next)}`);
  }

  const h1 = document.querySelector('h1');
  return {
    // Rozwiązana wartość --color-bg-subtle. Bez tego zwrotu nie da się sprawdzić,
    // czy metryka kremu w ogóle miała sens (patrz isResolvedCream).
    creamToken: CREAM,
    cream: creamEls.length,
    creamBands: topBands.length,
    creamBandList: topBands.slice(0, 4).map(describe),
    seams: seams.length,
    seamList: seams.slice(0, 3),
    overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    h1: h1 ? h1.textContent.trim().length : -1,
    title: document.title,
  };
};

// Gdy `--color-bg-subtle` zniknie albo zmieni nazwę, `var()` nie rozwiąże się do
// niczego i tło sondy-elementu zostaje PRZEZROCZYSTE. Porównanie
// `backgroundColor === CREAM` zaczyna wtedy łapać KAŻDY przezroczysty element na
// stronie — metryka R2 cicho traci sens, a raport dalej wygląda wiarygodnie.
function isResolvedCream(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  if (v === 'transparent' || v === '') return false;
  const alpha = v.match(/^rgba?\([^)]*?,\s*([\d.]+)\s*\)$/);
  if (alpha && parseFloat(alpha[1]) === 0) return false;
  return true;
}

// Znane NIE-defekty — wyliczone imiennie, nie wyciszone hurtem. Każdy ma powód
// i datę ważności; gdy powód znika, wpis też ma zniknąć.
const KNOWN_NON_DEFECTS = [
  { route: '/blog', match: /404/, why: 'blog ZAPARKOWANY (BLOG_ENABLED=false) — brak wpisów jest stanem docelowym' },
  { route: '/connection-check', match: /401/, why: 'sonda zdrowia woła endpoint wymagający sesji; bez logowania 401 jest poprawną odpowiedzią' },
  { route: '/app/favorites', match: /403/, why: 'Ulubione to trasa KLIENTKI (menu ma ją tylko w drawerze klientki); persona stylistki wchodzi tu wyłącznie z ręcznie wpisanego URL-a i RBAC ją słusznie odsyła na panel' },
];
// Dopasowanie na PEŁNY SEGMENT trasy, nie na prefiks tekstowy: wpis `/blog`
// obejmował też `/blogging` i każdą inną trasę zaczynającą się tymi znakami.
function matchKnownNonDefect(route, text) {
  const r = normalizePath(route);
  return KNOWN_NON_DEFECTS.find(
    k => (r === k.route || r.startsWith(k.route + '/')) && k.match.test(text)
  );
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
];

(async () => {
  const routes = readRoutes();
  let list = [];
  if (scope === '--public' || scope === '--all') list.push(...routes.static);
  if (scope === '--app' || scope === '--all')
    list.push(...routes.app.filter(r => !r.startsWith('/app/admin')));
  if (scope === '--admin' || scope === '--all')
    list.push(...routes.app.filter(r => r.startsWith('/app/admin')));

  const skipped = [];
  const addSkip = s => {
    if (!skipped.includes(s)) skipped.push(s);
  };
  list = list.filter(r => {
    if (!r.includes('[')) return true;
    if (PARAM_SAMPLES[r]) return true;
    addSkip(`${r} — brak próbki w PARAM_SAMPLES`);
    return false;
  });

  const findings = [];
  const knownHits = [];
  const rows = [];

  const tokens = {};
  const tokenErrors = {};
  for (const persona of new Set(list.map(personaFor).filter(Boolean))) {
    try {
      tokens[persona] = await fetchDevLoginToken(AUTH_EMAILS[persona]);
    } catch (e) {
      tokenErrors[persona] = e.message;
      console.error(`TOKEN ${persona}: ${e.message}`);
    }
  }
  // Brak tokenu persony = KOMPLET jej tras jest niezbadany. Kiedyś kończyło się
  // to `continue` bez śladu i raportem „ZBADANE: 0 przebiegów ✓ Zero znalezisk"
  // z EXIT=0 — czyli bramka meldowała sukces nad zerem ekranów.
  if (Object.keys(tokenErrors).length) {
    for (const [persona, msg] of Object.entries(tokenErrors)) {
      findings.push(`TOKEN ${persona}: ${msg} — WSZYSTKIE trasy tej persony są NIEZBADANE`);
    }
    list = list.filter(r => {
      const p = personaFor(r);
      if (p && tokenErrors[p]) {
        addSkip(`${r} — brak tokenu persony ${p} (dev-login padł)`);
        return false;
      }
      return true;
    });
  }

  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    for (const mode of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        ignoreHTTPSErrors: true,
        colorScheme: mode,
      });
      await applyCapturePrep(context);
      for (const route of list) {
        const persona = personaFor(route);
        const token = persona ? tokens[persona] : null;
        const url = BASE + (PARAM_SAMPLES[route] || route);
        const page = await context.newPage();
        const errors = [];
        page.on('console', m => m.type() === 'error' && errors.push(m.text().slice(0, 140)));
        // Hydration mismatch jest zdarzeniem `pageerror`, NIE console.error (S56) —
        // sam scan konsoli pokazywał 0 i MASKOWAŁ deterministyczny bug.
        page.on('pageerror', e => errors.push('pageerror: ' + String(e.message).slice(0, 140)));
        const tag = `${route} ${mode}/${vp.name}`;
        try {
          if (token) {
            await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.evaluate(t => localStorage.setItem('authorization', t), token);
          }
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          const status = response ? response.status() : null;
          await page.waitForTimeout(900);
          if (mode === 'dark') await switchToDark(page);
          await preScroll(page, { step: 900, pause: 60 });
          await page.waitForTimeout(250);
          let r = await page.evaluate(PROBE);
          // Pusty ALBO nieobecny h1 bywa artefaktem PRZEKIEROWANIA (RBAC odsyła
          // personę na inny ekran), a nie realnym brakiem nagłówka — jedno
          // powtórzenie po dosypce czasu odróżnia wyścig od defektu.
          if (r.h1 <= 0) {
            await page.waitForTimeout(900);
            r = await page.evaluate(PROBE);
          }

          // TWARDA AWARIA przed jakąkolwiek oceną: bez rozwiązanego tokenu kremu
          // liczby `cream`/`creamBands` są śmieciem, a nie pomiarem.
          if (!isResolvedCream(r.creamToken)) {
            console.error(
              `\n╳ TWARDA AWARIA SONDY: token kremu --color-bg-subtle nie rozwiązał się na ${tag} ` +
                `(computed: ${r.creamToken || 'pusto'}). Zmieniona/usunięta nazwa zmiennej albo brak palety — ` +
                `porównanie backgroundColor łapałoby wtedy KAŻDY przezroczysty element i metryka R2 byłaby bez sensu. ` +
                `Sprawdź --color-bg-subtle w main/src/UI/styles/themes/palettes.css.`
            );
            await page.close();
            await context.close();
            await browser.close();
            process.exit(1);
          }

          const landedRaw = page.url().replace(BASE, '');
          const landedOk = normalizePath(landedRaw) === normalizePath(route);
          rows.push({
            route,
            mode,
            vp: vp.name,
            landed: landedRaw,
            landedOk,
            status,
            ...r,
            errors: errors.length,
          });

          // Wylądowaliśmy gdzie indziej → mierzyliśmy CUDZĄ stronę. Nie oceniamy
          // jej pod nazwą deklarowanej trasy (tak /app było oceniane trzy razy
          // pod trzema nazwami, a cztery trasy miały ZEROWE pokrycie).
          if (!landedOk) {
            const bounce = expectedBounce(route, landedRaw, vp.name);
            if (bounce) {
              addSkip(`${route} — oczekiwany bounce na ${landedRaw}: ${bounce.why}`);
            } else {
              findings.push(
                `${tag}: PRZEKIEROWANIE na ${landedRaw} — deklarowana trasa NIEZBADANA (dopisz do EXPECTED_BOUNCES z powodem albo napraw)`
              );
            }
            await page.close();
            continue;
          }

          if (status !== null && status >= 400) {
            const okHttp = expectedHttp(route, status);
            if (okHttp) knownHits.push({ tag, route: okHttp.route, why: okHttp.why });
            else findings.push(`${tag}: HTTP ${status}`);
          }
          if (r.creamBands > 1) findings.push(`${tag}: ${r.creamBands} pasy kremu (${r.creamBandList.join(', ')})`);
          if (r.seams > 0) findings.push(`${tag}: ${r.seams} zlanych szwów (${r.seamList.join('; ')})`);
          if (r.overflow > 0) findings.push(`${tag}: overflow ${r.overflow}px`);
          // h1 === -1 (BRAK h1 w dokumencie) był kiedyś wyłączony z oceny —
          // jedyny sygnał „strona się nie wyrenderowała" przechodził na zielono.
          if (r.h1 <= 0) {
            const ok = h1Optional(route);
            if (ok) knownHits.push({ tag, route: ok.route, why: ok.why });
            else findings.push(`${tag}: ${r.h1 === -1 ? 'BRAK <h1> w dokumencie' : 'PUSTY h1'}`);
          }
          const realErrors = [];
          for (const e of errors) {
            const known = matchKnownNonDefect(route, e);
            if (known) knownHits.push({ tag, route: known.route, why: known.why });
            else realErrors.push(e);
          }
          if (realErrors.length) findings.push(`${tag}: ${realErrors.length} błędów konsoli — ${realErrors[0]}`);
        } catch (e) {
          findings.push(`${tag}: SONDA PADŁA — ${String(e.message).slice(0, 120)}`);
        }
        await page.close();
      }
      await context.close();
    }
  }
  await browser.close();

  if (skipped.length) {
    console.log('\nPOMINIĘTE (jawnie, nie po cichu):');
    skipped.forEach(s => console.log('  · ' + s));
  }
  if (knownHits.length) {
    // Wypisujemy WYŁĄCZNIE wyciszenia, które REALNIE zadziałały w tym przebiegu.
    // Wcześniej nagłówek liczył trafienia, a pod spodem drukowała się cała stała
    // KNOWN_NON_DEFECTS — także pozycje, których w danym zakresie nie odwiedzono.
    const byWhy = new Map();
    for (const h of knownHits) {
      const k = `${h.route}|${h.why}`;
      byWhy.set(k, (byWhy.get(k) || 0) + 1);
    }
    console.log(`\nZNANE NIE-DEFEKTY (${knownHits.length} trafień) — wyciszone imiennie:`);
    for (const [k, n] of byWhy) {
      const [route, why] = k.split('|');
      console.log(`  · ${route} ×${n}: ${why}`);
    }
  }

  const measured = rows.filter(r => r.landedOk);
  console.log(
    `\nZBADANE: ${measured.length} przebiegów na ${new Set(measured.map(r => r.route)).size} trasach ` +
      `(z ${list.length} podjętych tras × 2 tryby × 2 szerokości = ${rows.length} prób)`
  );
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));

  // Ostatnia bramka przed werdyktem: sukces nad ZEREM zbadanych ekranów jest
  // zawsze kłamstwem, niezależnie od tego, co go spowodowało.
  if (measured.length === 0) {
    findings.push(
      'ZERO REALNIE ZBADANYCH PRZEBIEGÓW — sonda nie zmierzyła ani jednego ekranu (padł token / trasy przekierowały / pusta lista). Sukces nad zerem nie istnieje.'
    );
  }

  if (findings.length) {
    console.log(`\nZNALEZISKA (${findings.length}):`);
    findings.forEach(f => console.log('  ✗ ' + f));
    process.exitCode = 1;
  } else {
    console.log('\n✓ Zero znalezisk: jeden krem na stronę, zero zlanych szwów, zero overflow, zero błędów konsoli.');
  }
})();

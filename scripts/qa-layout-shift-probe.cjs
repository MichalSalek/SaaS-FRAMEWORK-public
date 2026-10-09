#!/usr/bin/env node
/**
 * qa-layout-shift-probe — POMIAR „skoku układu" po zaznaczeniu kontrolki wyboru.
 *
 * PO CO TO ISTNIEJE (S126, zgłoszenie ownera 2026-10-08):
 *   „Jak zaznaczam cechę, to widok skacze, bo wskakuje chip z ilością wybranych"
 *   oraz „jak wybieram długość paznokci, to boksy skaczą, bo pojawia się znak
 *   wyboru i rozpycha boxy". Obie wady miały tę samą budowę: element montowany
 *   WARUNKOWO w normalnym przepływie (licznik w nagłówku sekcji, ikona w karcie),
 *   więc pierwsze zaznaczenie zmieniało geometrię sąsiadów. Tego nie widzi tsc,
 *   ESLint ani żaden audyt statyczny, a na zrzucie stan „przed" i „po" wyglądają
 *   poprawnie każdy z osobna. Skok istnieje tylko jako RÓŻNICA dwóch pomiarów.
 *
 * CO MIERZYMY:
 *   Dla każdej kontrolki wyboru (role radio/checkbox/switch, aria-pressed,
 *   aria-checked, input checkbox/radio) zapisujemy prostokąty: rodzeństwa
 *   kontrolki, jej rodzica oraz poprzedzającego rodzeństwa trzech kolejnych
 *   przodków (czyli nagłówka sekcji i wszystkiego NAD kontrolką). Klikamy,
 *   czekamy na commit Reacta i przejścia, mierzymy ponownie. Przesunięcie albo
 *   zmiana rozmiaru o więcej niż 1 px = naruszenie.
 *
 * CZEGO ŚWIADOMIE NIE MIERZYMY:
 *   • Zakładek (role=tab) i filtrów listy: wymiana treści PONIŻEJ kontrolki jest
 *     ich funkcją, nie wadą. Dlatego patrzymy tylko na rodzeństwo i na to, co
 *     stoi nad kontrolką.
 *   • Samej klikniętej kontrolki: zmiana jej wypełnienia to stan, nie skok
 *     (jej prostokąt też jest sprawdzany, ale osobną regułą: rozmiar ma zostać).
 *
 * UŻYCIE:
 *   node scripts/qa-layout-shift-probe.cjs
 *   ROUTES='/pl/app/gallery/upload-asset' QA_EMAIL=... node scripts/qa-layout-shift-probe.cjs
 *   PREPARE=upload-tags  — scenariusz dojścia do kroku cech (wstrzykuje plik testowy)
 *
 * WYJŚCIE: 0 = brak skoków, 1 = skoki, 2 = środowisko nieużywalne.
 */
const path = require('path');
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright')));
}

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const BACKEND = process.env.BACKEND_URL || 'http://localhost:3001';
const EMAIL = process.env.QA_EMAIL || 'demo-stylist-main@example.com';
const WIDTHS = (process.env.WIDTHS || '390,1024').split(',').map(Number);
const MAX_CONTROLS = Number(process.env.MAX_CONTROLS || 14);
const TOLERANCE = 1;

const DEFAULT_ROUTES = [
  '/pl/app/gallery',
  '/pl/app/gallery/upload-asset',
  '/pl/app/pairing',
  '/pl/app/clients',
  '/pl/app/user/account',
  '/pl/app/user/account/pay',
  '/pl/app/profile',
];
const ROUTES = process.env.ROUTES ? process.env.ROUTES.split(',') : DEFAULT_ROUTES;
// Fixtury: `--self-test` uruchamia sondę na dwóch stronach statycznych i wymaga,
// żeby pierwsza dała skok, a druga nie. Sonda, która nigdy nie widziała wady,
// niczego nie dowodzi.
const SELF_TEST = process.argv.includes('--self-test');

async function devLoginToken() {
  const res = await fetch(`${BACKEND}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email: EMAIL }),
  });
  const token = res.headers.get('authorization');
  if (!token) throw new Error(`dev-login gave no token (HTTP ${res.status})`);
  return token;
}

/** 1×1 PNG powiększany przez canvas do 900×1200, żeby kreator miał co kadrować. */
async function reachUploadTagStep(page) {
  const buffer = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = '#b08a7a';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#5a2a3a';
    g.fillRect(300, 400, 300, 400);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles('input[type=file]', {
    name: 'probe.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(buffer),
  });
  // Krok kadrowania: zatwierdzamy pierwszym wypełnionym przyciskiem belki akcji.
  await page.waitForSelector('.ReactCrop', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter(b => !b.disabled);
    const primary = buttons.reverse().find(b => /primary/.test(b.className));
    primary?.click();
  });
  await page.waitForTimeout(2500);
}

/** Wykonywane W STRONIE: indeksuje kontrolki wyboru i nadaje im znacznik. */
const TAG_CONTROLS = max => {
  const sel = [
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="switch"]',
    '[aria-pressed]',
    '[aria-checked]',
    'input[type="checkbox"]',
    'input[type="radio"]',
  ].join(',');
  const visible = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0;
  };
  const parked = el => !!el.closest('[class*="drawer"],[class*="Drawer"],[class*="verlay"]');
  const found = [...document.querySelectorAll(sel)].filter(
    el => visible(el) && !parked(el) && !el.disabled && !el.closest('[role="tablist"]')
  );
  // Rozrzut po grupach: bierzemy po kilka z każdego rodzica, nie 14 pierwszych chipów.
  const perParent = new Map();
  const picked = [];
  for (const el of found) {
    const n = perParent.get(el.parentElement) || 0;
    if (n >= 2) continue;
    perParent.set(el.parentElement, n + 1);
    picked.push(el);
    if (picked.length >= max) break;
  }
  picked.forEach((el, i) => el.setAttribute('data-shift-probe', String(i)));
  return picked.map(el => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40));
};

/** Wykonywane W STRONIE: prostokąty sąsiedztwa kontrolki `index`. */
const NEIGHBOUR_RECTS = index => {
  const el = document.querySelector(`[data-shift-probe="${index}"]`);
  if (!el) return null;
  const label = n => {
    const cls = (n.className || '').toString().split(/\s+/)[0] || '';
    return `${n.tagName.toLowerCase()}${cls ? '.' + cls.replace(/__[A-Za-z0-9_-]+$/, '') : ''}`;
  };
  const rect = n => {
    const r = n.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
  };
  const out = [];
  const push = (n, relation) => {
    if (!(n instanceof HTMLElement)) return;
    const s = getComputedStyle(n);
    if (s.display === 'none' || s.position === 'fixed') return;
    out.push({ key: `${relation}:${label(n)}:${out.length}`, relation, label: label(n), rect: rect(n) });
  };
  push(el, 'self');
  if (el.parentElement) {
    push(el.parentElement, 'parent');
    [...el.parentElement.children].forEach(c => c !== el && push(c, 'sibling'));
  }
  let anc = el.parentElement;
  for (let depth = 0; depth < 3 && anc && anc !== document.body; depth += 1) {
    let prev = anc.previousElementSibling;
    while (prev) {
      push(prev, `above-${depth}`);
      prev = prev.previousElementSibling;
    }
    anc = anc.parentElement;
  }
  return out;
};

function diff(before, after) {
  const moved = [];
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    const b = before[i];
    const a = after[i];
    if (b.label !== a.label) continue;
    const d = b.rect.map((v, k) => a.rect[k] - v);
    // Kontrolka sama może zmienić kolor, ale nie rozmiar ani miejsce.
    if (d.some(v => Math.abs(v) > TOLERANCE)) {
      moved.push(`${b.relation} ${b.label}: Δx ${d[0]} Δy ${d[1]} Δw ${d[2]} Δh ${d[3]}`);
    }
  }
  if (after.length !== before.length) {
    moved.push(`liczba elementów w sąsiedztwie ${before.length} → ${after.length} (montaż warunkowy)`);
  }
  return moved;
}

async function measure(browser, routes, widths, token) {
  let violations = 0;
  let measured = 0;
  for (const width of widths) {
    for (const route of routes) {
      const ctx = await browser.newContext({
        viewport: { width, height: 900 },
        isMobile: width < 500,
        hasTouch: width < 500,
      });
      await ctx.addInitScript(t => {
        if (t) window.localStorage.setItem('authorization', t);
        window.localStorage.setItem(
          'cookie-consent-v1',
          JSON.stringify({ state: { consent: { analytics: false, marketing: false } }, version: 0 })
        );
      }, token);
      const page = await ctx.newPage();
      // Absolutny adres (np. `file:` z fixturą) idzie bez prefiksu: tak sonda
      // sprawdza samą siebie na stronie, która NA PEWNO skacze.
      const target = /^(https?|file):/.test(route) ? route : `${BASE}${route}`;
      await page.goto(target, { waitUntil: 'load', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(3000);
      if (route.includes('upload-asset') && process.env.PREPARE !== 'none') {
        await reachUploadTagStep(page).catch(e =>
          console.log(`  (nie doszedłem do kroku cech na ${route}: ${e.message.slice(0, 80)})`)
        );
      }
      const labels = await page.evaluate(TAG_CONTROLS, MAX_CONTROLS);
      for (let i = 0; i < labels.length; i += 1) {
        const before = await page.evaluate(NEIGHBOUR_RECTS, i);
        if (!before) continue;
        const clicked = await page
          .evaluate(index => {
            const el = document.querySelector(`[data-shift-probe="${index}"]`);
            if (!el) return false;
            el.click();
            return true;
          }, i)
          .catch(() => false);
        if (!clicked) continue;
        await page.waitForTimeout(450);
        const after = await page.evaluate(NEIGHBOUR_RECTS, i);
        measured += 1;
        if (!after) continue;
        const moved = diff(before, after);
        if (moved.length) {
          violations += 1;
          console.log(`✗ ${route} @${width} „${labels[i]}"`);
          moved.slice(0, 6).forEach(m => console.log(`    ${m}`));
        }
      }
      await ctx.close();
    }
  }
  return { violations, measured };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  if (SELF_TEST) {
    const fixture = name => `file://${path.join(__dirname, '_fixtures', 'layout-shift', name)}`;
    const bad = await measure(browser, [fixture('must-fail.html')], [390], null);
    const good = await measure(browser, [fixture('must-pass.html')], [390], null);
    await browser.close();
    // Dwa kształty wady w fixturze (licznik w nagłówku, znak w karcie): oba muszą wyjść.
    const ok = bad.violations >= 2 && good.measured > 0 && good.violations === 0;
    console.log(`\nself-test: must-fail skoki=${bad.violations} (oczekiwane >=2), must-pass skoki=${good.violations} z ${good.measured} (oczekiwane 0) → ${ok ? 'OK' : 'FAIL'}`);
    process.exit(ok ? 0 : 1);
  }
  let token;
  try {
    token = await devLoginToken();
  } catch (e) {
    console.error(`SKIP: ${e.message}`);
    process.exit(2);
  }
  const { violations, measured } = await measure(browser, ROUTES, WIDTHS, token);
  await browser.close();
  console.log(`\nzmierzono ${measured} kontrolek na ${ROUTES.length} trasach × ${WIDTHS.length} szerokości; skoki: ${violations}`);
  if (measured === 0) {
    console.error('SKIP: nie znaleziono ani jednej kontrolki wyboru (sonda bez wejścia nie melduje sukcesu)');
    process.exit(2);
  }
  process.exit(violations ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(2);
});

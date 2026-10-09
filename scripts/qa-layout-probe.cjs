#!/usr/bin/env node
/**
 * qa-layout-probe — POMIAR układu w żywej przeglądarce: przepełnienie poziome,
 * cele dotykowe, ARYTMETYKA SAFE-AREA i zgodność z ramką.
 *
 * PO CO TO ISTNIEJE (S113):
 *   Poprzednia sesja znalazła siedem realnych wad UI wyłącznie MIERZĄC DOM, i żadnej
 *   z nich nie łapał ani jeden ze 107 audytów. Najgorsza: `BottomTabBar` miał
 *   `height: 56px` przy `box-sizing: border-box` PLUS `padding-bottom:
 *   env(safe-area-inset-bottom)`. Padding zjadał więc content-box zamiast powiększać
 *   pasek: przy wcięciu 34 px przyciski miały 21 px, etykiety 0 px, ikony ucięte.
 *   Premiera idzie na Androida z nawigacją gestową, czyli TO POSZŁOBY NA KAŻDY TELEFON.
 *
 *   Klasa jest strukturalna: `env(safe-area-inset-*)` w przeglądarce na biurku wynosi
 *   ZERO, więc wada jest niewidoczna wszędzie tam, gdzie ją oglądamy. Dlatego ta sonda
 *   nie „patrzy", tylko PODSTAWIA wcięcie i mierzy ponownie.
 *
 * JAK PODSTAWIAMY WCIĘCIE (istota pomiaru):
 *   `env()` nie da się nadpisać z CSS. Idziemy więc po CSSOM: każda reguła, której
 *   `cssText` zawiera `safe-area-inset-bottom`, jest wstawiana PONOWNIE do dopisanego
 *   arkusza z podmienionym `env(...)` na konkretne 34 px. Ten sam selektor + późniejsza
 *   pozycja = wygrywa kaskadę, a hashowane nazwy klas CSS Modules nie przeszkadzają,
 *   bo czytamy je z CSSOM, nie z plików.
 *
 * PUŁAPKI POMIARU (obie kosztowały poprzednią sesję):
 *   1. Zamknięta `AppDrawer` stoi zaparkowana POZA kadrem (transform), więc naiwny skan
 *      przepełnienia produkuje ~108 widmowych trafień na ekran. Filtrujemy poddrzewo
 *      szuflady i wszystko, co jest `visibility: hidden` / zerowej wielkości.
 *   2. Paleta serializuje kolory jako `lab()`/`oklch()`, więc regexowy parser koloru
 *      zwraca śmieci. Kontrastu TU NIE LICZYMY — ma własną sondę
 *      (`qa-contrast-probe.cjs`) z modelem kompozycji warstw. Nie duplikujemy.
 *
 * UŻYCIE:
 *   node scripts/qa-layout-probe.cjs                 # wszystkie trasy, 390 + 1440
 *   BASE_URL=... QA_EMAIL=... node scripts/qa-layout-probe.cjs
 *
 * WYJŚCIE: 0 = brak naruszeń, 1 = naruszenia, 2 = środowisko nieużywalne (skip).
 */

const path = require('path');
// Ta sama drabinka co w qa-contrast-probe.cjs: playwright bywa podniesiony do
// node_modules roota albo leży lokalnie przy skrypcie.
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright')));
}

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const BACKEND = process.env.BACKEND_URL || 'https://api.dev.example.com';
const EMAIL = process.env.QA_EMAIL || 'stylist@test.com';
const SIMULATED_INSET = 34; // Android gesture navigation, the launch fleet.
const MIN_TAP = 44;

// Trasy produktowe renderują się w ramce na desktopie; publiczne nie.
const ROUTES = [
  { path: '/pl/app', authed: true },
  { path: '/pl/app/home', authed: true },
  { path: '/pl/app/gallery', authed: true },
  { path: '/pl/app/explore', authed: true },
  { path: '/pl/app/profile', authed: true },
  { path: '/pl/app/user/account', authed: true },
  { path: '/pl/welcome', authed: false },
  { path: '/pl/get-app', authed: false },
];
const WIDTHS = [390, 1440];

async function devLoginToken() {
  const headers = { 'content-type': 'application/json', Origin: BASE };
  if (process.env.INTERNAL_SHARED_SECRET) {
    headers['x-internal-secret'] = process.env.INTERNAL_SHARED_SECRET;
  }
  const res = await fetch(`${BACKEND}/api/auth/dev-login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: EMAIL }),
  });
  const token = res.headers.get('authorization');
  if (!token) throw new Error(`dev-login gave no token (HTTP ${res.status})`);
  return token;
}

/** Wykonywane W STRONIE. Zwraca listę naruszeń dla bieżącej trasy/szerokości. */
const IN_PAGE = ({ inset, minTap, isTouchWidth }) => {
  const violations = [];
  const label = el => {
    const cls = (el.className || '').toString().split(/\s+/)[0] || '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  // Szuflada zamknięta stoi poza kadrem — jej poddrzewo to widma, nie wady.
  // Szuflada ORAZ zamknięta nakładka filtrów stoją zaparkowane poza kadrem —
  // ich poddrzewa to widma, nie wady.
  const inParked = el => !!el.closest('[class*="drawer"],[class*="Drawer"],[class*="Overlay"],[class*="overlay"]');
  const isVisible = el => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Wzorzec sr-only / skip-link / ukryty input pliku: element JEST w drzewie i ma
  // rozmiar, ale użytkownik go nie widzi ani nie dotyka. Bez tego filtra sonda
  // meldowała „cel 1×1" na ukrytym `<input type=file>` i „ucieczkę z ramki" na
  // skip-linku zaparkowanym poza kadrem — czyli szum zamiast wady.
  const isVisuallyHidden = el => {
    const s = getComputedStyle(el);
    if (parseFloat(s.opacity) === 0) return true;
    if (s.clipPath && s.clipPath !== 'none' && /inset\(\s*(50%|100%)/.test(s.clipPath)) return true;
    if (s.clip && s.clip !== 'auto' && /rect\(\s*0/.test(s.clip)) return true;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1) return true;
    if (r.right <= 0 || r.bottom <= 0) return true;
    return false;
  };

  // ── 1. przepełnienie poziome ────────────────────────────────────────────
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    const offenders = [...document.querySelectorAll('*')]
      .filter(el => !inParked(el) && isVisible(el) && !isVisuallyHidden(el))
      .filter(el => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .slice(0, 5)
      .map(label);
    violations.push({
      kind: 'horizontal-overflow',
      detail: `scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}; offenders: ${offenders.join(', ') || 'none isolated'}`,
    });
  }

  // ── 2. cele dotykowe ────────────────────────────────────────────────────
  // Cel DOTYKOWY ma sens na szerokości dotykowej. Na 1440 px to myszka, a WCAG 2.5.5
  // (44×44) dotyczy dotyku — mierzone na desktopie dawało 44 trafienia, wszystkie na
  // linkach nawigacji i checkboxach, i ani jednego na 390 px, gdzie realnie się klika.
  const interactive = isTouchWidth
    ? [...document.querySelectorAll('button,a[href],input,select,[role="button"],[role="tab"]')]
        .filter(el => !inParked(el) && isVisible(el) && !isVisuallyHidden(el))
    : [];
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (r.height < minTap - 0.5 || r.width < minTap - 0.5) {
      // Link w akapicie tekstu jest celem CZYTELNICZYM, nie dotykowym — WCAG
      // wyłącza go z 2.5.8 („inline"). Bez tego wyjątku każdy link w prozie fałszywkuje.
      const inProse = el.tagName === 'A' && el.closest('p,li,figcaption,small');
      if (inProse) continue;
      violations.push({
        kind: 'tap-target',
        detail: `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)} (min ${minTap})`,
      });
    }
  }

  // ── 3. arytmetyka safe-area ─────────────────────────────────────────────
  // Mierzymy PRZED i PO podstawieniu wcięcia. Poprawny pasek ROŚNIE; zepsuty
  // zjada własną treść, więc dzieci maleją albo znikają.
  const bar = document.querySelector('[class*="bottomTabBar"],[class*="BottomTabBar"],nav[class*="bottomNav"]');
  if (bar) {
    const kids = [...bar.querySelectorAll('a,button')].filter(isVisible);
    const before = {
      bar: bar.getBoundingClientRect().height,
      kids: kids.map(k => k.getBoundingClientRect().height),
      labels: kids.map(k => {
        const s = [...k.querySelectorAll('span')].find(x => x.textContent && x.textContent.trim());
        return s ? s.getBoundingClientRect().height : null;
      }),
    };

    // PODSTAWIENIE WCIĘCIA — przez ZMIENNĄ CSS, nie przez CSSOM.
    //
    // DECISION (nie usuwaj tego komentarza) — zmierzone S113: naprawa z S112 przepuszcza
    // inset przez nazwaną zmienną (`--tab-bar-pad-bottom: env(safe-area-inset-bottom, 0px)`),
    // żeby wysokość i padding NIE DAŁY SIĘ rozjechać. To jest dla sondy prezent: zamiast
    // przepisywać reguły w CSSOM wystarczy nadpisać zmienną.
    // Dwie rzeczy zmierzone i warte zapamiętania:
    //   1. Nadpisanie na `:root` NIE DZIAŁA — zmienna jest ustawiona na samym pasku, więc
    //      deklaracja lokalna wygrywa z dziedziczeniem. Ustawiamy ją NA ELEMENCIE.
    //   2. Nazwy zmiennych da się wyliczyć: `[...getComputedStyle(el)]` wypisuje także
    //      własności niestandardowe, więc bierzemy każdą, która niesie inset.
    const insetVars = [...getComputedStyle(bar)].filter(
      n => n.startsWith('--') && /safe|inset|pad-bottom/i.test(n)
    );
    let injected = 0;
    let alreadyApplied = 0;
    for (const name of insetVars) {
      const current = getComputedStyle(bar).getPropertyValue(name).trim();
      // tylko zmienne niosące DŁUGOŚĆ (kolor o nazwie „…inset-shadow" nas nie dotyczy)
      if (!/^-?[\d.]+px$|^0$|^$/.test(current)) continue;
      alreadyApplied = Math.max(alreadyApplied, parseFloat(current) || 0);
      bar.style.setProperty(name, `${inset}px`);
      injected++;
    }

    if (injected === 0) {
      violations.push({
        kind: 'safe-area-probe-inert',
        detail: `pasek nie wystawia ŻADNEJ zmiennej z wcięciem (${insetVars.join(',') || 'brak kandydatek'}) — sonda mierzyłaby nic, czyli fałszywa zieleń`,
      });
    } else {
      before.base = before.bar - alreadyApplied;
      void bar.getBoundingClientRect().height;
      const after = {
        bar: bar.getBoundingClientRect().height,
        kids: kids.map(k => k.getBoundingClientRect().height),
        labels: kids.map(k => {
          const s = [...k.querySelectorAll('span')].find(x => x.textContent && x.textContent.trim());
          return s ? s.getBoundingClientRect().height : null;
        }),
      };

      // Poprawny pasek ROŚNIE o wcięcie. Zepsuty zjada własny content-box.
      // Wysokość liczymy od BAZY, nie od stanu sprzed podstawienia: w trybie ramki
      // `AppLayout` już nadpisuje tę zmienną (zmierzone: 14px, pasek 70px), więc
      // „before + inset" byłoby podwójnym liczeniem i dawało FAŁSZYWKĘ. Baza to
      // wysokość paska bez wcięcia, czyli `before.bar - insetAlreadyApplied`.
      const expected = before.base + inset;
      if (after.bar < expected - 1) {
        violations.push({
          kind: 'safe-area-bar-did-not-grow',
          detail: `pasek ${before.bar}px (baza ${before.base}px) → ${after.bar}px przy wcięciu ${inset}px (oczekiwane ~${expected}px) — padding zjada content-box zamiast powiększać pasek`,
        });
      }
      after.kids.forEach((h, i) => {
        if (h < before.kids[i] - 1) {
          violations.push({ kind: 'safe-area-child-shrank', detail: `przycisk #${i}: ${before.kids[i]}px → ${h}px` });
        }
        if (h < minTap - 0.5) {
          violations.push({ kind: 'safe-area-child-below-tap', detail: `przycisk #${i} ma ${Math.round(h)}px przy wcięciu ${inset}px (min ${minTap})` });
        }
      });
      after.labels.forEach((h, i) => {
        if (h !== null && h < 1 && before.labels[i] > 0) {
          violations.push({ kind: 'safe-area-label-collapsed', detail: `etykieta #${i}: ${before.labels[i]}px → 0px` });
        }
      });
      for (const name of insetVars) bar.style.removeProperty(name);
    }
  }

  // ── 4. zgodność z ramką ─────────────────────────────────────────────────
  const shell = document.querySelector('[class*="appShell"]');
  if (shell && shell.getAttribute('data-app-frame') === 'true') {
    const s = shell.getBoundingClientRect();
    const escapees = [...document.querySelectorAll('*')]
      .filter(el => !inParked(el) && isVisible(el) && !isVisuallyHidden(el))
      .filter(el => {
        const st = getComputedStyle(el);
        return st.position === 'fixed' || st.position === 'absolute';
      })
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.right > s.right + 1 || r.left < s.left - 1;
      })
      .slice(0, 5)
      .map(el => {
        const r = el.getBoundingClientRect();
        return `${label(el)} [${Math.round(r.left)}..${Math.round(r.right)}] vs ramka [${Math.round(s.left)}..${Math.round(s.right)}]`;
      });
    for (const e of escapees) violations.push({ kind: 'frame-escape', detail: e });
  }

  return violations;
};

(async () => {
  let token = null;
  try {
    token = await devLoginToken();
  } catch (e) {
    console.error(`SKIP: ${e.message}`);
    process.exit(2);
  }

  const browser = await chromium.launch();
  const findings = [];
  let checks = 0;

  for (const width of WIDTHS) {
    for (const route of ROUTES) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      if (route.authed) {
        await ctx.addInitScript(t => localStorage.setItem('authorization', t), token);
      }
      const page = await ctx.newPage();
      try {
        await page.goto(BASE + route.path, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(1500);
        const landed = new URL(page.url()).pathname;
        const violations = await page.evaluate(IN_PAGE, { inset: SIMULATED_INSET, minTap: MIN_TAP, isTouchWidth: width <= 480 });
        checks++;
        for (const v of violations) findings.push({ route: landed, width, ...v });
      } catch (e) {
        findings.push({ route: route.path, width, kind: 'navigation-failed', detail: e.message.slice(0, 120) });
      }
      await ctx.close();
    }
  }
  await browser.close();

  // Podłoga obecności: zero zmierzonych ekranów to nie „czysto", tylko martwa sonda.
  if (checks === 0) {
    console.error('SCAN FLOOR: nie zmierzono ŻADNEGO ekranu — sonda jest martwa, nie czysta');
    process.exit(2);
  }

  console.log(`qa-layout-probe — zmierzono ${checks} ekranów (${ROUTES.length} tras × ${WIDTHS.length} szerokości)\n`);

  // BASELINE — zastany dług, zgodnie z konwencją repo (`legacy-code`, `breakpoints`).
  //
  // DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
  // Nowa bramka nad istniejącym kodem musi wystartować NA ZIELONO, inaczej pierwszy
  // przebieg jest czerwony, nikt jej nie naprawia i po tygodniu wszyscy ją omijają.
  // Zastane cele dotykowe są tu WYPISANE Z NAZWY (nie policzone), więc baseline nie
  // rośnie po cichu: nowa wada = nowy klucz = czerwień. Zdjęcie pozycji z tej listy
  // wymaga poprawki w UI i jest robotą dla `/ui`, nie dla przelotu obok:
  // powiększenie swatcha przestawia siatkę filtrów, więc to decyzja układu, nie liczba.
  //
  // Klasy `overflow`, `safe-area` i `frame-escape` mają baseline PUSTY i taki zostaje:
  // zmierzono je jako czyste na wszystkich 16 ekranach, więc każde trafienie to regresja.
  //
  // S126 (2026-10-09): lista przestała pasować do CZEGOKOLWIEK i sonda świeciła na
  // czerwono samym zastanym długiem. Dwie przyczyny: trasy są dziś raportowane z
  // końcowym ukośnikiem (`/welcome/`), a klucze go nie miały; dwa linki stopki
  // przeszły na `AppParagraphLinkAtom`, więc zmieniły klasę. Klucz normalizuje teraz
  // ukośnik, wpisy linków są przepisane na nową klasę, a wpis próbki koloru zniknął
  // razem z wadą (komórka siatki ma od S126 co najmniej 93 px).
  const BASELINE_TAP_TARGETS = new Set([
    '/welcome|button.CookieBanner-module__9Rk8SG__customizeBtn',
    '/get-app|button.CookieBanner-module__9Rk8SG__customizeBtn',
    '/get-app|a.PublicLayout-module__llBzXa__logoLink',
    '/get-app|button.AppBar-module__ScA7wa__hamburger',
    '/get-app|a.AppParagraphLink-module__EsGUjW__link',
    '/get-app|input|13x13',
  ]);
  // Klucz baseline'u musi jednoznacznie wskazywać ELEMENT. `label()` schodzi do gołego
  // tagu, gdy element nie ma klasy, więc wpisy `/get-app|a` i `/get-app|input` były
  // ŁAPKAMI NA WSZYSTKO: nowy bezklasowy link albo input na tej samej trasie wpadłby
  // w istniejący klucz i zostałby połknięty. Do klucza wchodzi więc także zmierzony
  // rozmiar — inny rozmiar to inny wpis, czyli czerwień (przegląd S113).
  const baselineKey = f => {
    const [selector, size] = f.detail.split(' ');
    // Selektor z klasą (hash CSS Modules) jest jednoznaczny — rozmiar do klucza NIE
    // wchodzi, bo ten sam element bywa różnej szerokości (swatche: 33/36/38 px).
    // Goły tag to co innego: `a` albo `input` bez klasy pasuje do czegokolwiek na
    // trasie, więc taki wpis dostaje rozmiar i przestaje być łapką na wszystko.
    const route = f.route.replace(/\/$/, '') || '/';
    return selector.includes('.')
      ? `${route}|${selector}`
      : `${route}|${selector}|${size ?? ''}`;
  };

  const known = [];
  const fresh = [];
  for (const f of findings) {
    if (f.kind === 'tap-target' && BASELINE_TAP_TARGETS.has(baselineKey(f))) known.push(f);
    else fresh.push(f);
  }

  if (known.length) {
    console.log(`Zastany dług (baseline, ${known.length}) — do podjęcia przez /ui, nie blokuje:`);
    const seen = new Set();
    for (const f of known) {
      const k = baselineKey(f);
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  - ${f.route}: ${f.detail}`);
    }
    console.log('');
  }

  if (fresh.length === 0) {
    console.log('LAYOUT PROBE CLEAN — zero przepełnień, wad safe-area i ucieczek z ramki; cele dotykowe bez nowych regresji');
    process.exit(0);
  }
  const byKind = fresh.reduce((acc, f) => ((acc[f.kind] = (acc[f.kind] || 0) + 1), acc), {});
  for (const f of fresh) console.log(`  [${f.kind}] ${f.route} @${f.width}px — ${f.detail}`);
  console.log(`\nLAYOUT PROBE FAILED — ${fresh.length} NOWYCH naruszeń: ${JSON.stringify(byKind)}`);
  process.exit(1);
})();

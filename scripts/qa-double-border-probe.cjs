#!/usr/bin/env node
/**
 * qa-double-border-probe — POMIAR podwójnych linii w żywej przeglądarce.
 *
 * PO CO TO ISTNIEJE (S114, 2026-09-14):
 *   Głos ownera S114/D zostawił ramę 1px na powierzchniach i 2px na kontrolkach.
 *   Owner od razu wskazał detal, którego nie łapie żaden audyt: dwie powierzchnie
 *   stykające się krawędzią rysują 1px + 1px, czyli z powrotem linię podwójnej
 *   grubości (ostatni wiersz listy z własną linią pod ramą listy, dwie sąsiednie
 *   sekcje z ramą, górna linia bandu CTA pod sekcją z ramą). W CSS nie da się tego
 *   wygrepować, bo sąsiedztwo powstaje dopiero w DOM, z różnych komponentów.
 *
 * CO MIERZY:
 *   Każdy widoczny bok ramy to pasek pikseli. Dwa paski tego samego kierunku,
 *   które się stykają albo nachodzą (odstęp <= 0,6px), dzielą co najmniej 16px
 *   długości i razem są grubsze niż grubszy z nich, dają podwójną linię.
 *   Paski w tych samych pikselach (świadome nałożenie ram) nie są naruszeniem.
 *
 * FAŁSZYWE TRAFIENIA, KTÓRE ODCINAMY (każde wyszło w pierwszym przebiegu):
 *   Elementy `sticky`/`fixed` i ich poddrzewa stoją nad treścią w przypadkowej
 *   pozycji przewijania (nagłówek, belka CTA, pływający przycisk wsparcia).
 *   Zwinięte menu i zaparkowane szuflady mają prostokąty poza widokiem.
 *
 * UŻYCIE:
 *   npm run qa:borders                        # strony statyczne 390+1440, aplikacja, admin
 *   BASE_URL=... BACKEND_URL=... npm run qa:borders
 *
 * WYJŚCIE: 0 = brak podwójnych linii, 1 = naruszenia, 2 = środowisko nieużywalne.
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
const USERS = {
  guest: null,
  stylist: process.env.QA_STYLIST_EMAIL || 'demo-stylist-main@example.com',
  client: process.env.QA_CLIENT_EMAIL || 'demo-client-main@example.com',
  admin: process.env.QA_ADMIN_EMAIL || 'test-admin-main@example.com',
};
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const STATIC = ['/', '/for-stylists', '/for-clients', '/for-studios', '/pricing', '/compare', '/get-app', '/about', '/contact', '/help', '/privacy', '/terms', '/user/login'];

// `crawl` = prefiks linków, po których sonda idzie dalej (jedna trasa na wzorzec).
const PLAN = [
  { as: 'guest', viewport: MOBILE, urls: STATIC },
  { as: 'guest', viewport: DESKTOP, urls: STATIC },
  { as: 'stylist', viewport: MOBILE, urls: ['/app', '/app/gallery', '/app/profile', '/app/user/account', '/app/user/account/pay', '/app/user/support', '/app/user/activity', '/app/gallery/upload-asset', '/app/user/delete-self'], crawl: '/app', max: 45 },
  { as: 'stylist', viewport: DESKTOP, urls: ['/app/home', '/app/profile', '/app/user/account', '/app/user/account/pay'] },
  { as: 'client', viewport: MOBILE, urls: ['/app', '/app/explore', '/app/favorites', '/app/user/account'], crawl: '/app', max: 30 },
  { as: 'admin', viewport: DESKTOP, urls: ['/app/admin'], crawl: '/app/admin', max: 40 },
];

const normalize = url => url.replace(/\?.*$/, '').replace(/\/[a-z0-9]{20,}/gi, '/:id');

async function devLoginToken(email) {
  const res = await fetch(`${BACKEND}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email }),
  });
  const token = res.headers.get('authorization');
  if (!token) throw new Error(`dev-login gave no token for ${email} (HTTP ${res.status})`);
  return token;
}

/** Wykonywane W STRONIE. Zwraca pary pasków tworzące podwójną linię. */
const IN_PAGE = () => {
  const label = el => {
    const raw = el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className;
    const cls = String(raw || '')
      .split(/\s+/)
      .filter(Boolean)
      .map(c => c.replace(/-module__[A-Za-z0-9_-]{5,6}__/, '.'))
      .join(' ');
    return cls || el.tagName.toLowerCase();
  };
  const floating = el => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.position === 'sticky' || s.position === 'fixed') return true;
      if (n.hasAttribute('inert')) return true;
    }
    return false;
  };
  const bands = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      const w = parseFloat(s[`border${side}Width`]);
      if (!w || s[`border${side}Style`] === 'none') continue;
      const color = s[`border${side}Color`];
      if (color === 'transparent' || /,\s*0\)$/.test(color)) continue;
      const horizontal = side === 'Top' || side === 'Bottom';
      const from = side === 'Top' ? r.top : side === 'Bottom' ? r.bottom - w : side === 'Left' ? r.left : r.right - w;
      bands.push({ el, horizontal, a: from, b: from + w, s: horizontal ? r.left : r.top, e: horizontal ? r.right : r.bottom, w, side });
    }
  }
  const live = bands.filter(band => !floating(band.el));
  const hits = new Map();
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i];
      const B = live[j];
      if (A.horizontal !== B.horizontal || A.el === B.el) continue;
      if (Math.min(A.e, B.e) - Math.max(A.s, B.s) < 16) continue;
      if (Math.max(A.a, B.a) - Math.min(A.b, B.b) > 0.6) continue;
      if (Math.max(A.b, B.b) - Math.min(A.a, B.a) <= Math.max(A.w, B.w) + 0.3) continue;
      const key = [`${label(A.el)} (${A.side})`, `${label(B.el)} (${B.side})`].sort().join('  +  ');
      hits.set(key, (hits.get(key) || 0) + 1);
    }
  }
  return [...hits.keys()];
};

async function main() {
  let browser;
  try {
    browser = await chromium.launch();
    const probe = await fetch(BASE, { method: 'HEAD' }).catch(() => null);
    if (!probe) throw new Error(`${BASE} nie odpowiada`);
  } catch (error) {
    console.log(`SKIP: środowisko nieużywalne (${error.message})`);
    if (browser) await browser.close();
    process.exit(2);
  }

  const tokens = {};
  const violations = [];
  for (const job of PLAN) {
    if (USERS[job.as] && !tokens[job.as]) tokens[job.as] = await devLoginToken(USERS[job.as]);
    const mobile = job.viewport.width < 500;
    const context = await browser.newContext({ viewport: job.viewport, isMobile: mobile, hasTouch: mobile, locale: 'pl-PL' });
    await context.addInitScript(token => {
      localStorage.setItem('cookie-consent-v1', JSON.stringify({ state: { consent: { analytics: false, marketing: false } }, version: 0 }));
      if (token) localStorage.setItem('authorization', token);
    }, tokens[job.as] || null);
    const page = await context.newPage();
    const seen = new Set();
    const queue = [...job.urls];
    while (queue.length && seen.size < (job.max || job.urls.length)) {
      const url = queue.shift();
      if (seen.has(normalize(url))) continue;
      seen.add(normalize(url));
      try {
        await page.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(4000);
        // Przewinięcie wymusza leniwe sekcje i animacje wejścia w stan końcowy.
        await page.evaluate(async () => {
          const scroller = document.querySelector('[class*="AppLayout-module"][class*="__content"]') || document.scrollingElement;
          for (let y = 0; y < scroller.scrollHeight; y += 700) {
            scroller.scrollTop = y;
            await new Promise(resolve => setTimeout(resolve, 60));
          }
        });
        await page.waitForTimeout(600);
        const where = `${job.as}@${job.viewport.width} ${normalize(page.url().replace(BASE, ''))}`;
        for (const pair of await page.evaluate(IN_PAGE)) violations.push(`${where}  ::  ${pair}`);
        if (job.crawl) {
          const links = await page.evaluate(prefix => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith(prefix)), job.crawl);
          for (const link of links) if (!seen.has(normalize(link))) queue.push(link);
        }
      } catch (error) {
        console.log(`  pomijam ${url}: ${error.message.slice(0, 100)}`);
      }
    }
    await context.close();
  }
  await browser.close();

  if (violations.length) {
    console.log(`✗ Podwójne linie: ${violations.length}`);
    for (const v of violations) console.log(`  ${v}`);
    console.log('Fix: ostatni wiersz w ramie bez linii, sąsiednie bandy przez prop `bordered` (DECISION w Section.module.css).');
    process.exit(1);
  }
  console.log('✓ Brak podwójnych linii na zmierzonych trasach');
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});

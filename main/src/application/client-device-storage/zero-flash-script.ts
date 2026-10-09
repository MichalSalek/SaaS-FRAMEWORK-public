// zero-flash-script.ts
// SSOT for the theme/FOUC-prevention inline <script> that runs in _document <Head>
// BEFORE React hydration (sets data-theme / data-mode / color-scheme from
// localStorage so there is no white flash on first paint).
//
// Why this lives outside _document.tsx: the script body must stay byte-identical
// in TWO places — _document.tsx RENDERS it, and proxy.ts (CSP middleware) must
// ALLOW it. On production-mode statically-generated pages there is NO per-request
// nonce (_document runs at build time), so the inline script is permitted via its
// SHA-256 hash in `script-src` instead of a nonce. proxy.ts runs in the Edge
// runtime (no `node:crypto`), so the hash is a PINNED constant here;
// zero-flash-script.test.ts recomputes it from ZERO_FLASH_SCRIPT and fails the
// build if the two ever drift.
//
// This module is intentionally lean (only imports the storage-key SSOT, no React /
// next/document) so proxy.ts can import the hash without pulling render deps into
// the Edge bundle.

import { ZERO_FLASH_STORAGE_KEYS } from './storage-keys.config';

/**
 * Inline pre-paint bridge. MUST be inline + synchronous (pre-paint). Two jobs:
 *
 * 1. THEME (FOUC): set data-theme / data-mode / color-scheme from localStorage so
 *    there is no white flash on first paint. Key NAMES injected from the shared
 *    SSOT (ZERO_FLASH_STORAGE_KEYS) via JSON.stringify, so this script and
 *    ThemeContext.tsx provably read the SAME localStorage keys.
 *
 * 2. NATIVE ENTRY (LP flash): when the Capacitor wrapper launches the remote at
 *    `/?platform=android|ios`, the landing page is the wrong entry — the wrapper
 *    IS the product. Doing this in a post-mount React guard
 *    (useNativeEntryRedirectGuard) means the heavy static LP paints + hydrates for
 *    ~1-2s BEFORE the redirect fires (owner-reported flash). Running it here,
 *    pre-paint, replaces the URL BEFORE the LP renders → the wrapper lands
 *    straight on the starter screen. Only fires when the native platform param /
 *    sessionStorage flag is present AND we are on the home path, so plain web
 *    visitors are never redirected (LP web-vitals untouched). Mirrors the guard's
 *    split: logged-in (token present) → /app, logged-out → /welcome. The guard
 *    stays as the SSR/no-JS fallback.
 *
 *    ONCE-PER-SESSION LATCH (`native_entry_resolved`): the redirect fires only on
 *    the FIRST home hit of a WebView session. Without it, a native user tapping
 *    "Strona główna" on /welcome (or "Wróć do strony głównej" on login) reloads
 *    `/`, this bridge re-redirects, and they are trapped in a loop with no way to
 *    the home LP (owner report). The flag is set on the first redirect here and in
 *    useNativeEntryRedirectGuard; a later user-initiated home visit renders the LP.
 *    sessionStorage clears on relaunch → a fresh launch still meets /welcome.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Literały 'platform' / 'native_app_platform' / 'native_entry_resolved' /
 * 'authorization' + prefiksy locale
 * ('/en','/de') są celowo zduplikowane (NIE import z platform.config / http.config /
 * next.config / storage-keys.config) — ten moduł jest lean (proxy.ts importuje z niego
 * hash do Edge-bundle; brak render/kernel deps). SSOT: PLATFORM_QUERY_PARAM +
 * PLATFORM_STORAGE_KEY + STORAGE_KEYS.NATIVE_ENTRY_RESOLVED
 * (platform.config), CUSTOM_HEADERS.authorization (http.config), i18n locales
 * pl/en/de (next.config, pl=default-bez-prefiksu). Zmiana którejkolwiek = zmień tu.
 * Home path per-locale ('/', '/en', '/de'), znormalizowany przez strip trailing
 * slash (next.config trailingSlash:true → '/en/' == '/en'), + wszystkie 3 sygnały
 * native (param / sessionStorage / __NATIVE_APP__ bridge) = pełny parytet z
 * detectPlatform + useNativeEntryRedirectGuard (który normalizuje locale via
 * router.pathname); redirect zachowuje prefiks locale (native na /de → /de/welcome,
 * nie gubi języka).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Ten skrypt SANITYZUJE slug motywu i tryb, zamiast stemplowac to, co zastal w
 * localStorage. Palety zyja w palettes.css WYLACZNIE pod selektorem
 * [data-theme='rouge-papier'][data-mode='light'|'dark'], wiec kazda inna wartosc
 * daje <html> z motywem BEZ TOKENOW: `body { background-color: var(--color-bg-main) }`
 * jest wtedy invalid-at-computed-value-time i cala strona maluje sie bez kolorow i
 * bez fontow az do hydracji. To nie jest przypadek teoretyczny: do glosowania
 * S105/S106 domyslnym motywem byl 'charcoal-gold', wiec KAZDY powracajacy
 * odwiedzajacy ma ten slug zapisany u siebie. ThemeContext ma wlasny
 * sanitizeTheme + write-back, ale dziala DOPIERO po hydracji — czyli o cale
 * pierwsze malowanie za pozno, ktore ten skrypt istnieje po to, zeby ratowac.
 * Literal 'rouge-papier' jest tu celowo zduplikowany (ten modul jest lean, bez
 * importow — proxy.ts bierze z niego hash do Edge-bundle). SSOT: DEFAULT_THEME w
 * UI/styles/ThemeContext.composition.tsx. Nowa paleta = dopisz ja TU i tam.
 *
 * ⚠️ Editing this string changes its SHA-256 → update ZERO_FLASH_SCRIPT_CSP_HASH
 * below (the guard test tells you the new value), or the inline script gets
 * CSP-blocked on prod-mode pages.
 */
export const ZERO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(ZERO_FLASH_STORAGE_KEYS.theme)}),m=localStorage.getItem(${JSON.stringify(ZERO_FLASH_STORAGE_KEYS.mode)}),r=m==='light'||m==='dark'?m:window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';d.setAttribute('data-theme',t==='rouge-papier'?t:'rouge-papier');d.setAttribute('data-mode',r);d.style.colorScheme=r}catch(e){}try{var L=window.location,pn=L.pathname,b=pn.length>1&&pn.charAt(pn.length-1)==='/'?pn.slice(0,-1):pn,lp=b==='/en'?'/en':b==='/de'?'/de':'',home=b==='/'||b==='/en'||b==='/de';if(home){var q=new URLSearchParams(L.search),p=q.get('platform'),s=sessionStorage.getItem('native_app_platform'),nb=window.__NATIVE_APP__,nat=p==='android'||p==='ios'||s==='android'||s==='ios'||(nb&&(nb.platform==='android'||nb.platform==='ios'));if(nat){if(p==='android'||p==='ios'){try{sessionStorage.setItem('native_app_platform',p)}catch(e){}}var er=null;try{er=sessionStorage.getItem('native_entry_resolved')}catch(e){}if(er==null){try{sessionStorage.setItem('native_entry_resolved','1')}catch(e){}var a='';try{a=localStorage.getItem('authorization')||''}catch(e){}L.replace(lp+(a?'/app':'/welcome')+L.search)}}}}catch(e){}})()`;

/**
 * CSP `script-src` token: `'sha256-<base64>'` of the EXACT bytes of
 * ZERO_FLASH_SCRIPT. Used by proxy.ts in the production-mode CSP so this one
 * inline script executes WITHOUT nonce/strict-dynamic (both impossible on SSG —
 * _document has no per-request nonce at build time). Pinned because proxy.ts is
 * Edge runtime; the sibling .test.ts recomputes and asserts equality (drift guard).
 */
export const ZERO_FLASH_SCRIPT_CSP_HASH =
  "'sha256-2hKDn+h6CvLfN/29S3f5GL2V8iBlV8Y4iZZblYI/FPg='";

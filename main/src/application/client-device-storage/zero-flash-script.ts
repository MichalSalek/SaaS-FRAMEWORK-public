// zero-flash-script.ts
// SSOT for the inline pre-paint <script> in _document <Head>. It sets the stored theme before the
// first paint so the page background and color-scheme never flash white during hydration.
//
// proxy.ts allows this exact inline body through a pinned CSP hash. Keep this module lean: proxy.ts
// runs on the Edge and must not pull render dependencies into its bundle.

import { ZERO_FLASH_STORAGE_KEYS } from './storage-keys.config';

// DECISION: the script SANITIZES the theme slug and mode instead of stamping what localStorage
// holds. Palettes exist in palettes.css ONLY under [data-theme='rouge-papier'][data-mode=...], so any
// other stored slug (returning visitors still hold the retired default) yields a theme with NO
// TOKENS and an uncoloured page until hydration. ThemeContext sanitizes too, but a whole paint later.
// 'rouge-papier' is duplicated for the same lean reason; SSOT is DEFAULT_THEME in
// UI/styles/ThemeContext.composition.tsx. A new palette must be added HERE and there.

/**
 * Inline pre-paint bridge; must be inline and synchronous. It themes the page and marks a bare
 * native-home launch pending so AppLifecycle cannot dismiss the splash before Next's router and
 * NativeEntryBootstrap are ready. Routing and session validation happen after hydration. A token's
 * presence alone is not a session verdict.
 *
 * Editing this string changes its SHA-256: update ZERO_FLASH_SCRIPT_CSP_HASH below (the guard test
 * prints the new value) or prod-mode pages CSP-block the script.
 */
export const ZERO_FLASH_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(ZERO_FLASH_STORAGE_KEYS.theme)}),m=localStorage.getItem(${JSON.stringify(ZERO_FLASH_STORAGE_KEYS.mode)}),r=m==='light'||m==='dark'?m:window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';d.setAttribute('data-theme',t==='rouge-papier'?t:'rouge-papier');d.setAttribute('data-mode',r);d.style.colorScheme=r}catch(e){}try{var L=window.location,pn=L.pathname,b=pn.length>1&&pn.charAt(pn.length-1)==='/'?pn.slice(0,-1):pn,home=b==='/'||b==='/en'||b==='/de';if(home&&L.hash===''){var q=new URLSearchParams(L.search),explicit=false;['authCode','code','qr','qrCode','qr_code','target','redirect','redirectTo','returnTo','next'].forEach(function(k){if(q.has(k))explicit=true});var p=q.get('platform'),s=null,er=null;try{s=sessionStorage.getItem('native_app_platform');er=sessionStorage.getItem('native_entry_resolved')}catch(e){}var nb=window.__NATIVE_APP__,native=p==='android'||p==='ios'||s==='android'||s==='ios'||(nb&&(nb.platform==='android'||nb.platform==='ios'));if(native&&!explicit&&er===null)document.documentElement.setAttribute('data-native-startup-pending','true')}}catch(e){}})()`;

/**
 * CSP `script-src` token: `'sha256-<base64>'` of the EXACT bytes of ZERO_FLASH_SCRIPT, used by
 * proxy.ts so this one inline script runs without a nonce (impossible on SSG pages). Pinned because
 * proxy.ts is Edge runtime; the sibling .test.ts asserts equality.
 */
export const ZERO_FLASH_SCRIPT_CSP_HASH =
  "'sha256-NJlc1NdQ12a4K4sjRv75YoT11sCXecFS3lWwCWJS+Dg='";

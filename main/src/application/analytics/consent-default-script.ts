// application/analytics/consent-default-script.ts
//
// DECISION: the Consent Mode `default` command must be the FIRST entry of `dataLayer`. GTM reads
// the queue in order, and the loader runs seconds after app code has pushed events (tracker start
// gate, tracker-start.ts), so a default set inside `public/analytics-bootstrap.js` would stand
// BEHIND them. This inline script runs at HTML parse time, before any bundle, and sets:
//  - `gtag('consent', 'default', …)`: ads denied, analytics granted (opt-OUT), analytics denied
//    when the stored banner choice refuses it;
//  - the same signal into Clarity's queue (`consentv2`).
// The bootstrap sets no default when this one is present; it only lifts a stored refusal withdrawn
// in this visit. Own traffic (`nf_internal`, DECISION in internal-traffic.ts) gets nothing.
//
// Lean on purpose (dependency-free SSOTs only): proxy.ts (Edge runtime) imports the pinned hash.
// Production `script-src` is hash-only for inline scripts: editing the string changes its SHA-256,
// so update CONSENT_DEFAULT_SCRIPT_CSP_HASH (the sibling test prints it) or production blocks it.

import { STORAGE_KEYS } from '../client-device-storage/storage-keys.config';
import { INTERNAL_TRAFFIC_COOKIE } from './internal-traffic.helpers';

const CONSENT_KEY = JSON.stringify(STORAGE_KEYS.COOKIE_CONSENT);

export const CONSENT_DEFAULT_SCRIPT = `(function(){var w=window,q=/[?&]${INTERNAL_TRAFFIC_COOKIE}=([01])(?:&|$)/.exec(w.location.search||'');if(q?q[1]==='1':/(?:^|;) *${INTERNAL_TRAFFIC_COOKIE}=1(?:;|$)/.test(document.cookie||''))return;var a='granted';try{var v=JSON.parse(localStorage.getItem(${CONSENT_KEY})||'null');if(v&&v.state&&v.state.consent&&v.state.consent.analytics===false)a='denied'}catch(e){}w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function')w.gtag=function(){w.dataLayer.push(arguments)};w.gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:a});w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};w.clarity('consentv2',{ad_Storage:'denied',analytics_Storage:a})})()`;

/** CSP `script-src` token: sha256 of the exact bytes of CONSENT_DEFAULT_SCRIPT. */
export const CONSENT_DEFAULT_SCRIPT_CSP_HASH =
  "'sha256-wFWdtaE5KzAHnn2JXBBUe6kXD7n2axryy3FFUqTzPl8='";

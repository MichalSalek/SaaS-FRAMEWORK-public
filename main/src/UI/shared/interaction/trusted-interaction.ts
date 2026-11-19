/**
 * Trusted-interaction gate: a reusable anti-bot mechanism (SSOT). One shared gate for "did a real
 * user interact with the page": false until the FIRST TRUSTED input event (mouse move / pointer /
 * wheel / tap / key / click), then true for the rest of the pageload.
 *
 * Consumers: <PiiTextAtom> reveals obfuscated PII only after interaction; public forms unlock
 * submit only after it (plus a hard check in the handler); human-only 3rd-party scripts load lazily.
 * Bots that EXECUTE JS render the page but do not synthesise trusted input events;
 * `dispatchEvent` events have `isTrusted === false` and are ignored.
 *
 * EVENTS deliberately EXCLUDE 'scroll' and 'focusin': the app or browser can synthesise both
 * without the user (programmatic .focus(), scroll restoration, #hash). Keyboard users still pass
 * via 'keydown'. This is a heuristic, not hard security: a bot driving real input (CDP) passes;
 * server-side Turnstile (web-1) covers that, and the layers ADD UP.
 */
export {
  hasTrustedInteraction,
  onTrustedInteraction,
  useTrustedInteraction,
} from '../../../application/security/trusted-interaction';

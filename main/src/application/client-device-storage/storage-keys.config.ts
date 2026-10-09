// storage-keys.config.ts
// SSOT for every client-device storage key carrying USER STATE (theme, mode,
// dismissals, scroll position, activation latch, consent, admin drafts).
//
// WHY THIS EXISTS (Wave W1.2 / kill Rank-1 FOUC):
//   Keys used to live as raw string literals scattered across components,
//   _document.tsx, and ThemeContext.tsx. The zero-flash bridge in _document.tsx
//   hardcoded 'theme'/'mode' while ThemeContext.tsx held its own LS_KEY_THEME /
//   LS_KEY_MODE constants — two independent literals for the SAME key. Any drift
//   between them (a rename on one side only) silently reintroduces the white
//   flash (FOUC) on first paint. This file is the single place those keys are
//   defined, so the inline bridge and the React context provably share ONE value.
//
// USAGE:
//   - Reads/writes go through the clientStorage adapter
//     (clientStorage.possibilities.api.ts) with a key from STORAGE_KEYS.
//   - The zero-flash inline script in _document.tsx receives ZERO_FLASH_STORAGE_KEYS
//     via JSON.stringify so it reads the exact same theme/mode keys at HTML parse
//     time, before hydration.
//
// SCOPE: USER-STATE keys only. Auth-channel tokens (CUSTOM_HEADERS.authorization
//   / .becomeUser) and the internal platform escape-hatch
//   (PLATFORM_STORAGE_KEY / PLATFORM_GATE_BYPASS_STORAGE_KEY) are deliberately
//   NOT defined here — see the audit allowlist in tests/audit/storage-keys.sh.

/* ─── Static user-state keys ─── */

export const STORAGE_KEYS = {
  /** Theme palette slug (e.g. "rouge-papier"). Read by the zero-flash bridge. */
  THEME: 'theme',
  /** Light/dark/system preference. Read by the zero-flash bridge. */
  MODE: 'mode',
  /** Cookie/GDPR consent decision (Zustand `persist` store name). */
  COOKIE_CONSENT: 'cookie-consent-v1',
  /** First-session celebration latch (one-time confetti on session detail). */
  FIRST_SESSION_CELEBRATED: 'first-session-celebrated',
  /** JSON array of dismissed announcement ids (per-announcement, permanent). */
  DISMISSED_ANNOUNCEMENTS: 'nailfolio_dismissed_announcements',
  /** Trial countdown banner dismissed for THIS session (sessionStorage). */
  TRIAL_BANNER_DISMISSED: 'trial_banner_dismissed',
  /** Explore feed scroll position to restore on back-navigation (sessionStorage). */
  EXPLORE_SCROLL_POSITION: 'explore-scroll-position',
  /** Pricing → login → onboarding → pay funnel: chosen {planId, billingPeriod}
   *  carried across the auth round-trip (sessionStorage; URL query overrides). */
  PRICING_FUNNEL: 'nf:pricing-funnel',
  /** Szkic onboardingu: wpisane pola + numer kroku (sessionStorage). Onboarding
   *  trzyma stan w Reakcie, a bramka planu zawraca na niego z KAŻDEJ trasy /app,
   *  więc jedno omyłkowe wyjście z lejka kasowało wszystko, co użytkowniczka
   *  zdążyła wpisać, i cofało ją na krok pierwszy (zmierzone S123). */
  ONBOARDING_DRAFT: 'nf:onboarding-draft',
  /** Ekran panelu admina (ścieżka + query), z którego admin wcielił się w
   *  użytkownika; „Wróć do siebie" ląduje dokładnie tam, z filtrami
   *  (sessionStorage, walidowane w application/auth/identity-switch.ts). */
  IMPERSONATION_RETURN_URL: 'nf:impersonation-return-url',
  /** Native wrapper: the cold-start entry redirect (home → /welcome or /app)
   *  already fired this WebView session. Subsequent visits to home are
   *  USER-INITIATED navigation ("Strona główna" from welcome, "Wróć" from login)
   *  and must NOT be bounced back to /welcome — otherwise the user is trapped in a
   *  redirect loop with no way to reach the home LP (owner report). sessionStorage:
   *  cleared on app relaunch, so a fresh launch still lands on /welcome.
   *  ALSO hardcoded in zero-flash-script.ts (lean pre-paint bridge) — keep in sync. */
  NATIVE_ENTRY_RESOLVED: 'native_entry_resolved',
  /** Epoch ms of the last login STARTED in this browser/WebView (magic-link
   *  request, web or native OAuth start); localStorage, TTL 30 min, cleared by
   *  a completed exchange. Read by the ?authCode exchange to tell a login this
   *  browser asked for from a handed-over link (application/auth/login-confirmation.ts). */
  LOGIN_STARTED_AT: 'nf:login-started-at',
  /** Owner choices in the /dev/playground vote shell, `{ [voteId]: candidateId }`
   *  (dev and staging only; validated against the open-vote registry on read). */
  PLAYGROUND_VOTES: 'nf:playground-votes',
} as const;

/* ─── Per-entity (prefixed) user-state keys ─── */
//
// These keys are namespaced by a runtime id (accountId / threadId), so they are
// exposed as builder functions over a stable prefix. The prefix itself is the
// SSOT literal; callers MUST go through the builder, never concatenate inline.

const STORAGE_KEY_PREFIXES = {
  /** Per-account activation high-water latch: `nf:activation:<accountId>`. */
  ACTIVATION_LATCH: 'nf:activation:',
  /** Per-thread admin internal-note draft: `admin-support-notes:<threadId>`. */
  ADMIN_SUPPORT_NOTES: 'admin-support-notes:',
  /** Per-account marketing-catch latch: `nf:marketing-catch:<userId>` —
   *  one-time post-first-photo opt-in prompt was already shown/answered. */
  MARKETING_CATCH: 'nf:marketing-catch:',
  /** Per-Checkout-Session analytics latch: `nf:checkout-completed:<sessionId>` —
   *  `onboarding_completed` for a PAID stylist fires on the Stripe return page,
   *  which the user can reload; sessionStorage keeps the event once per session. */
  CHECKOUT_COMPLETED: 'nf:checkout-completed:',
} as const;

/** Build the per-account activation-latch key. */
export const activationLatchKey = (accountId: string): string =>
  `${STORAGE_KEY_PREFIXES.ACTIVATION_LATCH}${accountId}`;

/** Build the per-thread admin internal-note key. */
export const adminSupportNotesKey = (threadId: string): string =>
  `${STORAGE_KEY_PREFIXES.ADMIN_SUPPORT_NOTES}${threadId}`;

/** Build the per-account marketing-catch latch key (keyed by userId). */
export const marketingCatchKey = (accountId: string): string =>
  `${STORAGE_KEY_PREFIXES.MARKETING_CATCH}${accountId}`;

/** Build the per-Checkout-Session analytics latch key. */
export const checkoutCompletedKey = (sessionId: string): string =>
  `${STORAGE_KEY_PREFIXES.CHECKOUT_COMPLETED}${sessionId}`;

/**
 * The exact subset of keys the zero-flash inline script needs. Kept as its own
 * object so _document.tsx serializes a minimal, audited payload (theme + mode)
 * rather than the whole registry.
 */
export const ZERO_FLASH_STORAGE_KEYS = {
  theme: STORAGE_KEYS.THEME,
  mode: STORAGE_KEYS.MODE,
} as const;

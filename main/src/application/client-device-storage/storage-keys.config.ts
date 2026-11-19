// storage-keys.config.ts
// SSOT for every client-device storage key carrying USER STATE (theme, mode, dismissals, scroll
// position, activation latch, consent, admin drafts).
//
// One definition keeps the zero-flash bridge in _document.tsx and ThemeContext.tsx on the same
// 'theme'/'mode' keys; a rename on one side only would bring back the white flash on first paint.
//
// Reads/writes go through the clientStorage adapter (clientStorage.possibilities.api.ts) with a key
// from STORAGE_KEYS. The inline zero-flash script receives ZERO_FLASH_STORAGE_KEYS via JSON.stringify.
//
// SCOPE: user-state keys only. Auth-channel tokens (CUSTOM_HEADERS.authorization / .becomeUser) and
// the platform escape hatch (PLATFORM_STORAGE_KEY / PLATFORM_GATE_BYPASS_STORAGE_KEY) are NOT here;
// see the audit allowlist in nf/storage-adapter-only.

/* ─── Static user-state keys ─── */

export const STORAGE_KEYS = {
  /** Theme palette slug (e.g. "rouge-papier"). Read by the zero-flash bridge. */
  THEME: 'theme',
  /** Light/dark/system preference. Read by the zero-flash bridge. */
  MODE: 'mode',

  COOKIE_CONSENT: 'cookie-consent-v1',
  /** First-session celebration latch (one-time confetti on session detail). */
  FIRST_SESSION_CELEBRATED: 'first-session-celebrated',
  /** JSON array of dismissed announcement ids (per-announcement, permanent). */
  DISMISSED_ANNOUNCEMENTS: 'nailfolio_dismissed_announcements',
  /** Explore feed scroll position to restore on back-navigation (sessionStorage). */
  EXPLORE_SCROLL_POSITION: 'explore-scroll-position',
  /** Pricing → login → onboarding → pay funnel: chosen {planId, billingPeriod}
   *  carried across the auth round-trip (sessionStorage; URL query overrides). */
  PRICING_FUNNEL: 'nf:pricing-funnel',
  /** Device-local, identity-scoped navigation intent after a purchase. */
  PURCHASE_RESUME: 'nf:purchase-resume-v1',
  /** Same-tab proof of a completed direct subscription change. */
  PURCHASE_CHANGE_PROOF: 'nf:purchase-change-proof-v1',
  /** First public page attribution carried through a passwordless login link. */
  FIRST_TOUCH: 'nf:first-touch',
  /** Push soft ask (notifications v2): „Nie teraz” hides the cards on this
   *  device until this epoch-ms date (domain/notifications/push/push-soft-ask.ts). */
  PUSH_SOFT_ASK_SNOOZED_UNTIL: 'nf:push-soft-ask-snoozed-until',
  /** Per-user native device choices and last backend-acknowledged push endpoint. */
  NATIVE_PUSH_STATE: 'nf:native-push-state-v1',
  EMAIL_LIFECYCLE_PENDING: 'nf:email-lifecycle-pending',
  EMAIL_LIFECYCLE_ATTRIBUTION: 'nf:email-lifecycle-attribution',
  /** Explicit device choice that takes precedence over automatic admin tagging. */
  INTERNAL_TRAFFIC_OVERRIDE: 'nf:internal-traffic-override',
  /** Legacy onboarding draft (sessionStorage), from before onboarding asked only for the role.
   *  Nothing writes it any more; the key stays so logout clears a draft left in an open tab. */
  ONBOARDING_DRAFT: 'nf:onboarding-draft',
  /** Admin screen (path + query) the admin impersonated from; "switch back" returns exactly there
   *  with filters (sessionStorage, validated in application/auth/identity-switch.ts). */
  IMPERSONATION_RETURN_URL: 'nf:impersonation-return-url',
  /** Native wrapper: the cold-start entry redirect (home → /welcome or /app)
   *  already fired this WebView session. Subsequent visits to home are
   *  USER-INITIATED navigation ("Strona główna" from welcome, "Wróć" from login)
   *  and must NOT be bounced back to /welcome — otherwise the user is trapped in a
   *  redirect loop with no way to reach the home LP (owner report). sessionStorage:
   *  cleared on app relaunch, so a fresh launch still lands on /welcome.
   *  Written by the hydrated native entry coordinator after a target screen is ready. */
  NATIVE_ENTRY_RESOLVED: 'native_entry_resolved',
  /** Epoch ms of the last login STARTED in this browser/WebView (magic-link
   *  request, web or native OAuth start); localStorage, TTL 30 min, cleared by
   *  a completed exchange. Read by the ?authCode exchange to tell a login this
   *  browser asked for from a handed-over link (application/auth/login-confirmation.ts). */
  LOGIN_STARTED_AT: 'nf:login-started-at',
  /** One-time recovery reload after a page arrived WITHOUT its messages
   *  (`{ url, at }`, sessionStorage; application/i18n/missing-messages-recovery.ts). */
  I18N_MISSING_MESSAGES_RELOAD: 'nf:i18n-missing-messages-reload',
  /** Last build that reloaded after a missing CSS/JS chunk (sessionStorage). */
  CHUNK_RECOVERY_BUILD: 'nf:chunk-recovery-build',
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
  /** Per-user conversion latch: `nf:signup-completed:<userId>`. */
  SIGNUP_COMPLETED: 'nf:signup-completed:',
  /** Per-table column choice of an admin list: `nf:table-columns:<tableId>`,
   *  JSON `{ [columnId]: boolean }` for the switchable columns (DataTable). */
  TABLE_COLUMNS: 'nf:table-columns:',
  /** Per-account latch of the notes screen: `nf:note-bio-bridge:<accountId>`,
   *  the stylist answered the offer to show her private note as her profile text. */
  NOTE_BIO_BRIDGE: 'nf:note-bio-bridge:',
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

/** Build the persistent signup-completed analytics latch key. */
export const signupCompletedKey = (userId: string): string =>
  `${STORAGE_KEY_PREFIXES.SIGNUP_COMPLETED}${userId}`;

/** Build the per-account „note as profile text” offer latch key. */
export const noteBioBridgeKey = (accountId: string): string =>
  `${STORAGE_KEY_PREFIXES.NOTE_BIO_BRIDGE}${accountId}`;

/** Build the per-table column-visibility key (DataTable `columnVisibility`). */
export const tableColumnsKey = (tableId: string): string =>
  `${STORAGE_KEY_PREFIXES.TABLE_COLUMNS}${tableId}`;

/**
 * The exact subset of keys the zero-flash inline script needs. Kept as its own
 * object so _document.tsx serializes a minimal, audited payload (theme + mode)
 * rather than the whole registry.
 */
export const ZERO_FLASH_STORAGE_KEYS = {
  theme: STORAGE_KEYS.THEME,
  mode: STORAGE_KEYS.MODE,
} as const;

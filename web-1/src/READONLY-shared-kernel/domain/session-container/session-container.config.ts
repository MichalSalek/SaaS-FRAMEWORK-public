// DECISION (nie usuwaj tego komentarza):
// "session-container" = wizyta/sesja-stylingu (domena biznesowa).
// Celowo odróżniona od auth-`session` (better-auth token).
// Frontend feature `sessions` = ekran wizyt (frontend tnie po EKRANACH, nie po backend bounded-contextach).
// NIE rename: kolizja semantyczna z auth-session, 71 refs w kodzie.

/**
 * SESSION_CONTAINER_CONFIG
 *
 * Single Source of Truth for the multi-photo session container feature (R8).
 *
 * Business rules:
 * - Client builds a SessionContainer (collection of stylist's gallery photos with notes)
 * - Container starts in DRAFT — no expiry, not visible to stylist
 * - Container moves to READY when client adds >= 1 photo (UI-only state, share gate)
 * - Container moves to SHARED on push share — stylist sees it in /app/shared
 * - SHARED container expires after 7 days from sharedAt (matches SESSION_SHARE_CONFIG)
 * - ACTIVE = SHARED + ongoing edits (UI-only label; same DB state)
 * - CLOSED = manual close by either party; EXPIRED = TTL hit
 * - Max 3 active sessions per CLIENT (max 1 per paired stylist) — DOMAIN_SSOT §3.2
 */

export const SESSION_CONTAINER_CONFIG = Object.freeze({
  /**
   * Max parallel SHARED|ACTIVE SessionContainers a single CLIENT can hold across
   * all her paired stylists. Mirrors DOMAIN_SSOT §3.2: a client may pair with max
   * 3 stylists and holds at most 1 non-terminal session per paired stylist — so at
   * most 3 live sessions total. The pair invariant (1 per (client,stylist)) is
   * enforced in create + the partial-unique index session_container_active_pair_uq.
   *
   * DECISION (nie usuwaj tego komentarza): partial-unique 'session_container_active_pair_uq'
   * jest nieekspresowalny w Prisma schema (filtered WHERE lifecycle_state NOT IN (CLOSED,EXPIRED)
   * AND stylist_account_id IS NOT NULL) → tworzony idempotentnie raw-SQL na starcie w
   * web-1/src/application/startup/ensure-db-indexes.ts. db push go NIE zarzadza. Catch P2002
   * 'active_pair' (session-container create + add-photo) polega na tym indeksie.
   *
   * DECISION (nie usuwaj tego komentarza):
   * INVARIANT: SESSION_MAX_ACTIVE_PER_CLIENT MUSI byc >= PLATFORM_LIMITS.MAX_PAIRED_STYLISTS
   * (oba == 3). Per-client cap w shareSessionContainer_IO liczy aktywne sesje pod
   * READ COMMITTED (count-then-update), wiec NIE jest sam w sobie race-safe dla wielu
   * roznych sesji. Faktycznym, strukturalnym backstopem przeciw przekroczeniu jest
   * partial-unique index na pare (client,stylist) == 1 aktywna sesja, pomnozona przez
   * MAX_PAIRED_STYLISTS par = twardy strop liczby sesji per klientka. Jesli ten cap
   * spadnie PONIZEJ MAX_PAIRED_STYLISTS, struktura przestaje go gwarantowac i staje
   * sie on race-bypassowalny pod READ COMMITTED (count widzi tylko stan sprzed
   * rownoleglych TX). Zmiana ktorejkolwiek wartosci wymaga utrzymania tej nierownosci.
   */
  SESSION_MAX_ACTIVE_PER_CLIENT: 3,

  /**
   * Display name length cap (User input: e.g. "Wesele kuzynki").
   */
  SESSION_NAME_MAX_LENGTH: 100,

  /**
   * Per-side note length cap (stylist_note OR client_note).
   */
  SESSION_NOTE_MAX_LENGTH: 500,

  /**
   * Days after sharedAt → expires_at = sharedAt + 7d (R8).
   */
  SESSION_EXPIRY_DAYS: 7,
} as const);

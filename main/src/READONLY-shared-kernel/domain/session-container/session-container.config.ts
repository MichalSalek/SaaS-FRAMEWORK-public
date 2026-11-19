// DECISION: "session-container" is the business domain (a styling visit/session), deliberately named
// apart from the auth `session` (better-auth token). The frontend `sessions` feature is the visits
// screen (the frontend splits by screens, not backend bounded contexts). Do not rename: it would
// collide semantically with auth-session (71 refs).

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
 * - SHARED container expires after the configured window from sharedAt
 * - ACTIVE = SHARED + ongoing edits (UI-only label; same DB state)
 * - CLOSED = manual close by either party; EXPIRED = TTL hit
 * - Max 3 active sessions per CLIENT (max 1 per paired stylist) — DOMAIN_SSOT §3.2
 */

export const SESSION_CONTAINER_CONFIG = Object.freeze({
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
   * Whole 24-hour days after sharedAt. Edits never restart the clock.
   *
   * DECISION: 30 days (owner), replacing 14. A client choosing two weeks before the
   * visit must not lose the active session on that boundary. One window for every plan. Authored
   * copy and generated mirrors resolve the policy token from this constant. Existing live sessions
   * may only be extended; closed and already expired sessions are never reactivated.
   */
  SESSION_EXPIRY_DAYS: 30,
} as const);

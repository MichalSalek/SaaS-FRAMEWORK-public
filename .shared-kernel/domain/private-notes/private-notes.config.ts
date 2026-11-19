/**
 * Bounds of the private notes hub (ACCOUNT_GET_PRIVATE_NOTES).
 *
 * Each list (client-card notes, session notes, visit notes) returns at most
 * LIST_MAX rows, newest first; the hub says so when a list was cut. The
 * client filter lists at most CLIENTS_MAX clients.
 */
export const PRIVATE_NOTES_CONFIG = Object.freeze({
  LIST_MAX: 50,
  CLIENTS_MAX: 300,
  /** Active pairs read to resolve client-card and visit notes (newest pairs first). */
  PAIRS_MAX: 1000,
  /** Upper bound of the `client_user_id` filter (ids are well under it). */
  CLIENT_ID_MAX: 64,
} as const);

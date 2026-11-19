/**
 * Messaging domain errors (stylist<->client messenger).
 *
 * MESSAGING_PAIR_NOT_FOUND = the pair does not exist OR the caller is not a party of it. ONE type on
 * purpose (anti-enumeration): a 404-vs-403 split would reveal which pair_id are real (IDOR). The
 * error mapper returns a uniform 404 (parity with SUPPORT_THREAD_NOT_FOUND/NOT_AUTHORIZED).
 *
 * MESSAGING_NOT_ALLOWED = the caller IS a party but the pair is REVOKED, so sending is blocked
 * (history is read-only). 403 without masking, because the caller is a legitimate party.
 *
 * MESSAGING_RATE_LIMITED = the user's hourly send limit is exceeded, 429. It carries
 * `retryAfterSeconds` because otherwise it looked like the per-IP limiter's 429, whose headers
 * describe ITS short window; a client honouring them retried every few seconds for an hour. The value
 * comes from the oldest message in the window, so it is real, not rounded up to the full window.
 */

export type MessagingPairNotFoundError = {
  type: 'MESSAGING_PAIR_NOT_FOUND';
};

export type MessagingNotAllowedError = {
  type: 'MESSAGING_NOT_ALLOWED';
};

export type MessagingRateLimitedError = {
  type: 'MESSAGING_RATE_LIMITED';
  retryAfterSeconds: number;
};

export type MessagingError =
  | MessagingPairNotFoundError
  | MessagingNotAllowedError
  | MessagingRateLimitedError;

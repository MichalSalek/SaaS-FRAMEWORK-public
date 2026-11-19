export const SESSION_EXPIRES_IN_SECONDS = 172800;

// 60 * 60 // 3600 s === 1h
// 60 * 60 * 16 // 57600 s === 16 h
// 60 * 60 * 24 // 86400 s === 24 h
// 86400 * 2 // 172800 s === 48 h

/**
 * Seconds a client should wait before retrying a request answered with 503 AUTH_UNAVAILABLE
 * (the server could not resolve the session or permissions because its own infrastructure failed).
 * Sent as the `Retry-After` header and as `data.retryAfter` (a cross-origin browser cannot read
 * `Retry-After`, it is not a CORS-safelisted response header).
 */
export const AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS = 5;

/**
 * Error codes of the magic-link send throttle (web-1 auth/login-abuse/magic-link-send-gate.hook.ts),
 * read by the login screen: RATE_LIMITED answers 429, the two TURNSTILE codes answer 428 and make
 * the screen show the Cloudflare Turnstile challenge before the next send.
 */
export const MAGIC_LINK_GATE_CODES = {
  RATE_LIMITED: 'MAGIC_LINK_RATE_LIMITED',
  TURNSTILE_REQUIRED: 'TURNSTILE_REQUIRED',
  TURNSTILE_INVALID: 'TURNSTILE_INVALID',
} as const;

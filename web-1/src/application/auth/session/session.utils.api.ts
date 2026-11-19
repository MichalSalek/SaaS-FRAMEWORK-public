import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

/**
 * Single source of truth for session transport header name.
 *
 * Historically housed a suite of manual-session helpers (header parsing,
 * expiry checks, refresh math). After WAVE 4 those were all absorbed by
 * Better Auth (`auth.api.getSession` + the `bearer()` plugin + `session.updateAge`).
 *
 * The constant alone survives because custom admin impersonation (WAVE 5)
 * and dev-login still need to stamp and clear this header directly — their
 * flows deliberately bypass Better Auth's sign-in endpoints.
 */
export const SESSION_HEADER_NAME = CUSTOM_HEADERS.authorization;

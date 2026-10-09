import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Cloudflare Turnstile — server-side token verification (siteverify).
 *
 * Feature-flag BY PRESENCE: `TURNSTILE_SECRET_KEY` set = verification enabled
 * (the contact-form handler REQUIRES a valid token), empty = disabled entirely
 * (dev/staging run without the widget). The secret never gates boot
 * (env-schema: required 'optional', format 'secret').
 *
 * DECISION (nie usuwaj tego komentarza):
 * FAIL-CLOSED on infrastructure errors — a Cloudflare siteverify outage, 5xx,
 * network error, malformed response or timeout all return `ok: false` and the
 * contact form rejects the submission (403). Trade-off made explicitly: spam
 * bots are an ACTIVE problem on this public endpoint and every accepted
 * submission fans out an email to the admin inbox; a rare few-minutes window of
 * "contact form unavailable" during a CF incident costs less than an open
 * fail-open bypass that any bot can trigger AT WILL by degrading/timing out the
 * verify call (fail-open = the attacker controls the failure mode). Legit users
 * get a clear 403 + retry message, and unexpected failures are reported via
 * `reportIssueBackend` (mode 'warn') so an outage is visible in the event log.
 * Do NOT flip this to fail-open without an owner decision.
 */

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Timeout for the siteverify roundtrip — same 5s bound the sibling outbound
 * calls use (admin-check-access, health-check). Hit timeout ⇒ fail-closed. */
const SITEVERIFY_TIMEOUT_MS = 5_000;

/**
 * Presence gate — read LAZILY on each call (not module-load) so tests and
 * runtime config are honored (same pattern as trust-aware-ip getTrustedProxyDepth).
 */
export const isTurnstileEnabled = (): boolean =>
  ENV_VARS.TURNSTILE_SECRET_KEY.length > 0;

export type TurnstileVerifyResult = {
  ok: boolean;
  /** Diagnostic reason — CF error-codes (joined) or a local failure marker.
   * SERVER-SIDE only; the error-mapper never echoes it to the client. */
  reason: string;
};

/** Shape of the (relevant part of the) siteverify JSON response. */
type SiteverifyResponse = {
  success?: unknown;
  'error-codes'?: unknown;
};

const extractErrorCodes = (parsed: SiteverifyResponse): string => {
  const codes = parsed['error-codes'];
  if (Array.isArray(codes) && codes.length > 0) {
    return codes.filter((c): c is string => typeof c === 'string').join(',');
  }
  return 'no-error-code';
};

/**
 * Verify a Turnstile response token against Cloudflare siteverify.
 *
 * @param token     the widget response token from the client (`turnstile_token`).
 * @param remoteIp  TRUST-AWARE client IP (resolveTrustedClientIp) or null when
 *                  unavailable — `remoteip` is optional for CF and only ever
 *                  omitted, never guessed from spoofable headers.
 *
 * Never throws — every failure mode collapses to `{ ok: false }` (fail-closed,
 * see the DECISION above). Callers MUST check `isTurnstileEnabled()` first;
 * calling with the feature disabled is a programming error and fails closed too
 * (missing secret can never silently verify).
 */
export const verifyTurnstileToken = async ({
  token,
  remoteIp,
}: {
  token: string;
  remoteIp: string | null;
}): Promise<TurnstileVerifyResult> => {
  const secret = ENV_VARS.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Defensive: the handler gates on isTurnstileEnabled() before calling.
    return { ok: false, reason: 'secret-not-configured' };
  }

  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) {
    form.set('remoteip', remoteIp);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      // CF-side 5xx/4xx — infrastructure failure, NOT a token verdict → warn + fail-closed.
      reportIssueBackend({
        namespace: 'TURNSTILE_VERIFY',
        message: 'Turnstile siteverify returned a non-OK HTTP status',
        payload: { status: response.status },
        mode: 'warn',
      });
      return { ok: false, reason: `siteverify-http-${response.status}` };
    }

    let parsed: SiteverifyResponse;
    try {
      parsed = (await response.json()) as SiteverifyResponse;
    } catch {
      reportIssueBackend({
        namespace: 'TURNSTILE_VERIFY',
        message: 'Turnstile siteverify returned malformed JSON',
        payload: {},
        mode: 'warn',
      });
      return { ok: false, reason: 'siteverify-malformed-json' };
    }

    if (parsed.success === true) {
      return { ok: true, reason: 'verified' };
    }

    // A NEGATIVE VERDICT (bad/expired/duplicate token) is the expected hot path
    // for bots — deliberately NOT reported (would let a bot flood the event log).
    return { ok: false, reason: extractErrorCodes(parsed) };
  } catch (error) {
    clearTimeout(timeoutId);
    const isAbort = error instanceof Error && error.name === 'AbortError';
    reportIssueBackend({
      namespace: 'TURNSTILE_VERIFY',
      message: isAbort
        ? 'Turnstile siteverify timed out'
        : 'Turnstile siteverify network error',
      payload: error instanceof Error ? error : {},
      mode: 'warn',
    });
    return {
      ok: false,
      reason: isAbort ? 'siteverify-timeout' : 'siteverify-network',
    };
  }
};

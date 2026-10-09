/**
 * CANNOT_LOGIN — failed authentication audit (D2).
 *
 * DECISION (nie usuwaj tego komentarza):
 * WHY hooks.after (not before):
 *   Better Auth surfaces the endpoint result via `ctx.context.returned` ONLY
 *   after the handler runs. APIError thrown by sign-in routes (invalid
 *   credentials, email not verified, rate limit) AND redirects with `?error=`
 *   (magic-link verify, OAuth callback) both materialize as APIError instances
 *   on `returned` (better-call wraps `redirect()` as APIError("FOUND") — see
 *   node_modules/better-call/dist/context.mjs L61-64). A before-hook has no
 *   visibility into outcome. After-hook is therefore the SINGLE detection
 *   point covering every failure path:
 *     - POST /sign-in/email      → 401/403 APIError (INVALID_EMAIL_OR_PASSWORD, EMAIL_NOT_VERIFIED)
 *     - POST /sign-in/social     → may set `?error=` via redirect (OAuth init)
 *     - GET  /callback/:provider → 302 redirect to errorURL with ?error=...
 *     - GET  /magic-link/verify  → 302 redirect with ?error=INVALID_TOKEN|EXPIRED_TOKEN|ATTEMPTS_EXCEEDED
 *     - POST /sign-in/magic-link → APIError (validation errors)
 *     - Account disabled         → APIError surfaced by sign-in handler logic
 *
 * GRANICA TEGO AUDYTU — CZEGO NIE WIDZI (zmierzone S121, 2026-09-16):
 *   Ten hook widzi WYLACZNIE odrzucenia, ktore przeszly przez `dispatchAuthEndpoint`,
 *   bo dopiero on ustawia `ctx.context.returned` (i dopiero po nim leci `hooks.after`).
 *   Odrzucenia ZANIM dojdzie do dispatchu nie zostawiaja tu sladu:
 *     - 429 z limitera — nasz `withRateLimitCheck` w `pages/api/auth/[...all].ts`
 *       zwraca odpowiedz przed wejsciem w Better Auth; wlasny limiter biblioteki
 *       odpowiada z `onRequest`, czyli tez przed dispatchem;
 *     - `INVALID_CALLBACK_URL` / `INVALID_REDIRECT_URL` — rzuca je `originCheckMiddleware`,
 *       ktory jest middleware ROUTERA (`path: "/**"`), a nie endpointu.
 *
 * WHY the full source IP:
 *   The failed-login source IP is stored untruncated: brute-force /
 *   credential-stuffing detection needs the exact source address, and a /24
 *   prefix merges unrelated clients behind one key. Do NOT truncate it (see the
 *   note at the rawIp extraction below).
 *
 *   Email is stored in `event_payload.email`: a forensic investigation needs the
 *   exact address an attacker targeted, and for unknown addresses it shows
 *   enumeration attempts. The EventLog trim (LIFO per user via
 *   MAX_EVENT_LOGS_PER_USER) bounds how many rows stay. HMAC(email, secret) is a
 *   drop-in alternative with an unchanged schema.
 *
 * WHY anomaly placeholder (not integrated):
 *   anomaly-alerts.operation.ts runs on email lifecycle sweep cadence and
 *   currently covers pairing volume + upload error rate. Adding a "5 fails /
 *   60s per source IP" rule is a future enhancement once we have baseline
 *   data post-launch. Failed-login EventLog rows are the substrate that future
 *   detection rule will query — emitting them now unblocks that work without
 *   premature alerting tuning.
 */

import type { GenericEndpointContext } from 'better-auth';
import { isAPIError } from 'better-auth/api';

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { extractIpFromFetchHeaders } from '@app/http/extract-client-info';

import { getDispatchReturned } from './better-auth-dispatch-context';

type PathMatcher = { prefix: string; defaultProvider: string };

const AUTH_FAILURE_PATH_MATCHERS: ReadonlyArray<PathMatcher> = [
  { prefix: '/sign-in/email', defaultProvider: 'email' },
  { prefix: '/sign-in/social', defaultProvider: 'social' },
  { prefix: '/sign-in/magic-link', defaultProvider: 'magic-link' },
  { prefix: '/magic-link/verify', defaultProvider: 'magic-link' },
  { prefix: '/callback/', defaultProvider: 'oauth' },
];

const matchAuthFailurePath = (path: string | undefined): PathMatcher | null => {
  if (!path) {
    return null;
  }
  for (const matcher of AUTH_FAILURE_PATH_MATCHERS) {
    if (path.startsWith(matcher.prefix)) {
      return matcher;
    }
  }
  return null;
};

const detectFailureProvider = (
  ctx: GenericEndpointContext,
  matcher: PathMatcher
): string => {
  const path = ctx.path ?? '';
  if (matcher.prefix === '/callback/') {
    // /callback/google → 'google', /callback/apple → 'apple'
    return path.slice('/callback/'.length).split('/')[0] || 'oauth';
  }
  if (matcher.prefix === '/sign-in/social') {
    const bodyProvider =
      typeof ctx.body === 'object' &&
      ctx.body !== null &&
      'provider' in ctx.body &&
      typeof (ctx.body as { provider: unknown }).provider === 'string'
        ? (ctx.body as { provider: string }).provider
        : null;
    return bodyProvider ?? matcher.defaultProvider;
  }
  return matcher.defaultProvider;
};

const extractAttemptEmail = (ctx: GenericEndpointContext): string | null => {
  const body = ctx.body;
  if (typeof body === 'object' && body !== null) {
    if (
      'email' in body &&
      typeof (body as { email: unknown }).email === 'string'
    ) {
      return (body as { email: string }).email;
    }
    if (
      'identifier' in body &&
      typeof (body as { identifier: unknown }).identifier === 'string'
    ) {
      return (body as { identifier: string }).identifier;
    }
  }
  // Magic-link verify carries no body — email is locked inside the verification
  // token and isn't surfaced to hooks. Return null; reason code still captures
  // the failure.
  return null;
};

type AuthFailureSignal = {
  reasonCode: string;
  statusCode: number | null;
};

const extractLocationHeader = (
  headers: HeadersInit | undefined
): string | null => {
  if (!headers) {
    return null;
  }
  if (headers instanceof Headers) {
    return headers.get('location');
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[0].toLowerCase() === 'location' &&
        typeof entry[1] === 'string'
      ) {
        return entry[1];
      }
    }
    return null;
  }
  // Record<string, string>
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'location' && typeof value === 'string') {
      return value;
    }
  }
  return null;
};

const extractErrorQueryParam = (location: string): string | null => {
  try {
    // Location may be absolute or relative — URL needs a base for relative URLs.
    const url = new URL(location, 'http://placeholder.local');
    const error = url.searchParams.get('error');
    if (error && error.length > 0) {
      return error.toUpperCase();
    }
    return null;
  } catch {
    return null;
  }
};

const extractFailureFromReturned = (
  returned: unknown
): AuthFailureSignal | null => {
  // SUCCESS path: returned is the response object (json, redirect-to-success).
  // We must NOT emit CANNOT_LOGIN. APIError discrimination handles both
  // thrown errors AND redirects (redirect() returns APIError("FOUND")).
  if (!isAPIError(returned)) {
    return null;
  }
  // APIError: thrown by sign-in handler OR redirect from magic-link/OAuth
  // callback. Discriminate by inspecting the Location header (redirects) or
  // body.code (throws).
  const apiError = returned as {
    statusCode?: number;
    status?: string | number;
    headers?: HeadersInit;
    body?: { code?: string; message?: string };
  };
  const statusCode =
    typeof apiError.statusCode === 'number' ? apiError.statusCode : null;

  // Redirect responses (302 FOUND with Location header containing ?error=).
  // These are SUCCESS redirects EXCEPT when the URL carries an `error` param.
  if (statusCode === 302 || apiError.status === 'FOUND') {
    const locationHeader = extractLocationHeader(apiError.headers);
    if (locationHeader) {
      const errorParam = extractErrorQueryParam(locationHeader);
      if (errorParam) {
        return { reasonCode: errorParam, statusCode };
      }
      // 302 without ?error= = success redirect (set-cookie + → callbackURL).
      return null;
    }
  }

  // Thrown APIError from sign-in handler — extract canonical error code.
  const bodyCode = apiError.body?.code;
  if (typeof bodyCode === 'string' && bodyCode.length > 0) {
    return { reasonCode: bodyCode, statusCode };
  }

  // Fallback: HTTP status family.
  if (statusCode !== null) {
    if (statusCode === 429) {
      return { reasonCode: 'RATE_LIMITED', statusCode };
    }
    if (statusCode >= 400) {
      return { reasonCode: `HTTP_${statusCode}`, statusCode };
    }
  }

  return null;
};

const lookupUserIdByEmail_IO = async (
  email: string | null
): Promise<string | null> => {
  if (!email) {
    return null;
  }
  try {
    const user = await DB_CLIENT.use.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return user?.id ?? null;
  } catch (error) {
    reportIssueBackend({
      namespace: 'BA_HOOK_CANNOT_LOGIN_LOOKUP',
      message: 'Failed to look up user by email for CANNOT_LOGIN audit',
      payload: error,
      mode: 'warn',
    });
    return null;
  }
};

type FailureContext = {
  matcher: PathMatcher;
  failure: AuthFailureSignal;
  provider: string;
  email: string | null;
  userAgent: string | null;
  acceptLanguage: string | null;
  clientIp: string | null;
  path: string | null;
};

const buildFailureContext = (
  ctx: GenericEndpointContext
): FailureContext | null => {
  const matcher = matchAuthFailurePath(ctx.path);
  if (!matcher) {
    return null;
  }
  const failure = extractFailureFromReturned(getDispatchReturned(ctx));
  if (!failure) {
    return null;
  }
  const provider = detectFailureProvider(ctx, matcher);
  const email = extractAttemptEmail(ctx);
  const headers: Headers | undefined =
    ctx.request?.headers ?? ctx.headers ?? undefined;
  const userAgent = headers?.get('user-agent') ?? null;
  const acceptLanguage = headers?.get('accept-language') ?? null;
  // Pełny adres IP: detekcja nadużyć i brute-force potrzebuje dokładnego źródła.
  // Nie przycinać do /24.
  const rawIp = headers ? extractIpFromFetchHeaders(headers) : null;
  return {
    matcher,
    failure,
    provider,
    email,
    userAgent,
    acceptLanguage,
    clientIp: rawIp,
    path: ctx.path ?? null,
  };
};

const writeFailureAudit_IO = async (
  failureCtx: FailureContext
): Promise<void> => {
  const userId = await lookupUserIdByEmail_IO(failureCtx.email);

  // Without a userId we cannot write to EventLog (FK constraint on
  // created_by_user_id). We still surface the attempt to issue tracker so
  // the security signal is preserved (brute-force email enumeration visible
  // in logs / future anomaly rule).
  // DECISION (nie usuwaj tego komentarza): brak timing-side-channel defense tutaj jest
  // CELOWY. handleAuthFailure jest fire-and-forget (void writeFailureAudit_IO, patrz
  // niżej) — response Better Auth wraca do klienta ZANIM ta detached robota (lookup +
  // ew. EventLog write) się wykona, więc known- i unknown-email ścieżki są nieodróżnialne
  // w round-tripie HTTP z samej natury detachu. Poprzedni constantTimeDelay_IO (jitter)
  // opóźniał TYLKO odłączony promise, nigdy odpowiedzi → był martwą obroną (chronił coś,
  // czego nie dało się zmierzyć); usunięty.
  if (!userId) {
    reportIssueBackend({
      namespace: 'BA_HOOK_CANNOT_LOGIN',
      message: 'Failed login attempt for unknown email (no EventLog row)',
      payload: {
        path: failureCtx.path,
        provider: failureCtx.provider,
        reasonCode: failureCtx.failure.reasonCode,
        statusCode: failureCtx.failure.statusCode,
        client_ip: failureCtx.clientIp,
        user_agent: failureCtx.userAgent,
        email_present: failureCtx.email !== null,
      },
      mode: 'warn',
    });
    return;
  }

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.USER.CANNOT_LOGIN,
    eventLogType: EventLogTypeValue.LOGIN,
    meta: {
      created_by_user_id: userId,
      user_agent: failureCtx.userAgent,
      client_ip: failureCtx.clientIp,
      language: failureCtx.acceptLanguage,
    },
    eventPayloadToStringify: {
      provider: failureCtx.provider,
      reason_code: failureCtx.failure.reasonCode,
      status_code: failureCtx.failure.statusCode,
      path: failureCtx.path,
      // Email is included for forensic audit — see DECISION block above.
      email: failureCtx.email,
    },
  });
};

/**
 * Emit a CANNOT_LOGIN audit event when an authentication path fails.
 * Invoked from the global `hooks.after` middleware in better-auth.config.ts.
 *
 * Fire-and-forget by design: the synchronous prelude reads `ctx.context.returned`
 * + `ctx.path` + `ctx.headers` (cheap, all in-memory) and the async DB work
 * (user lookup + EventLog insert) runs detached so the auth response is
 * returned to the client immediately. Errors are swallowed and logged so they
 * never propagate to the outer middleware chain.
 */
export const handleAuthFailure = (ctx: GenericEndpointContext): void => {
  let failureCtx: FailureContext | null = null;
  try {
    failureCtx = buildFailureContext(ctx);
  } catch (error) {
    reportIssueBackend({
      namespace: 'BA_HOOK_CANNOT_LOGIN_GUARD',
      message: 'buildFailureContext threw unexpectedly (swallowed)',
      payload: error,
      mode: 'error',
    });
    return;
  }
  if (!failureCtx) {
    return;
  }
  void writeFailureAudit_IO(failureCtx).catch((error: unknown) => {
    reportIssueBackend({
      namespace: 'BA_HOOK_CANNOT_LOGIN',
      message: 'Failed to push CANNOT_LOGIN event log (swallowed)',
      payload: error,
      mode: 'error',
    });
  });
};

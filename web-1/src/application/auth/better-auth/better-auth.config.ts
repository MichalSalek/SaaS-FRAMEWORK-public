/**
 * Better Auth configuration, replacing the former NextAuth v4 stack. Session fields are
 * `user.additionalFields`. Sign-in and sign-out are `hooks.after`. User create is
 * `databaseHooks.user.create`. Magic link, Google and Apple replace the providers, and
 * session create stamps device info. Custom admin impersonation stays (no `admin()` plugin).
 * Apple is gated on APPLE_* env vars.
 */

import { betterAuth, type GenericEndpointContext } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { createAuthMiddleware } from 'better-auth/api';
import { bearer, magicLink } from 'better-auth/plugins';

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_FRONT_STATIC } from '@kernel/domain/routing/routing.config';
import { SESSION_EXPIRES_IN_SECONDS } from '@kernel/application/auth/auth.config';
import {
  SystemRoleId,
  type SystemRoleIdType,
} from '@kernel/models/db_models.manual.dto';
import {
  AccountTypeValue,
  EventLogTypeValue,
} from '@kernel/models/db_models.generated.dto';

import { isAdminEmail } from '@app/admin/admin.utils.api';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { sendVerificationRequest } from '@app/email-handler/adapters/magic-link.adapter';
import { ENV_VARS } from '@app/environment/environment.config';
import { CORS_ALLOWED_ORIGINS } from '@app/cors/cors.config';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { extractIpFromFetchHeaders } from '@app/http/extract-client-info';
import { parseDeviceType } from '@app/auth/session/parse-device-type';

import {
  generateAppleClientSecret,
  getOrRefreshAppleClientSecret,
} from './apple-jwt-signer';
import { resolveCanonicalFrontendOrigin } from './auth-token-bridge';
import { handleAuthFailure } from './better-auth-failure-tracking';
import {
  normalizeAuthRedirectTargets,
  pinFailedRedirectToFrontend,
} from './auth-redirect-targets';
import { buildAccountLinkingOptions } from './account-linking.config';
import { USER_ADDITIONAL_FIELDS } from './user-fields.config';
import { LOGIN_LIMIT_OPTIONS } from '../login-abuse/login-abuse.config';
import { enforceMagicLinkSendGate } from '../login-abuse/magic-link-send-gate.hook';
import {
  handleLoginTokenBridge,
  handleOAuthCallback,
  handleSessionCreated,
  handleSignOut,
} from './better-auth-hooks';

// -----------------------------------------------------------------------------
// Apple provider — feature-flagged by presence of all four APPLE_* env vars.
// When unset, `socialProviders.apple` is omitted entirely (no `undefined` value
// leaking into the union type).
// -----------------------------------------------------------------------------
const APPLE_ENABLED = Boolean(
  ENV_VARS.APPLE_ID &&
  ENV_VARS.APPLE_TEAM_ID &&
  ENV_VARS.APPLE_KEY_ID &&
  ENV_VARS.APPLE_PRIVATE_KEY
);

// Top-level await is OK: web-1 is an ESM package (`"type": "module"`) compiled
// with `module: ESNext` / `target: ESNext` / `moduleResolution: bundler`.
// Apple's client_secret is a signed JWT (max 6 months lifetime) and Better
// Auth's social provider options require it as a `string` synchronously.
// The await runs once at module load; the signed JWT is then reused across
// requests until process restart.
//
// Defensive try/catch: if JWT signing fails (malformed private key,
// unreachable Apple endpoint, clock skew) we disable Apple provider rather
// than crashing the entire auth module at import time.
type AppleConfigShape = {
  clientId: string;
  clientSecret: string;
  appBundleIdentifier?: string;
};

let appleConfig: AppleConfigShape | null = null;
if (APPLE_ENABLED) {
  try {
    const clientSecret = await generateAppleClientSecret({
      clientId: ENV_VARS.APPLE_ID,
      teamId: ENV_VARS.APPLE_TEAM_ID,
      keyId: ENV_VARS.APPLE_KEY_ID,
      // Environment normalises `\n` escapes — but some deployment pipelines
      // still inject literal `\\n`. Defensive replace mirrors the legacy
      // NextAuth handler behaviour.
      privateKey: ENV_VARS.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
    appleConfig = {
      clientId: ENV_VARS.APPLE_ID,
      clientSecret,
      ...(ENV_VARS.APPLE_APP_BUNDLE_IDENTIFIER
        ? { appBundleIdentifier: ENV_VARS.APPLE_APP_BUNDLE_IDENTIFIER }
        : {}),
    };
  } catch (error) {
    reportIssueBackend({
      namespace: 'APPLE_JWT_INIT',
      message:
        'Failed to generate Apple client_secret — Apple provider disabled',
      payload: error,
      mode: 'error',
    });
    appleConfig = null;
  }
}

// -----------------------------------------------------------------------------
// detectRegistrationProvider — best-effort classification of the auth path that
// triggered user.create. Maps Better Auth route paths to a stable provider tag
// for audit/analytics consumption. Returns 'unknown' when the context is
// missing (e.g. user created via server-side seeding or admin operation).
//
// Path conventions (Better Auth defaults):
//   POST /sign-up/email                    → 'email'
//   POST /sign-in/magic-link               → 'magic-link' (request)
//   POST /sign-in/magic-link/verify        → 'magic-link' (callback)
//   GET  /magic-link/verify                → 'magic-link' (callback variant)
//   POST /sign-in/social { provider: 'google'|'apple' } → social provider name
//   GET  /callback/{provider}              → OAuth callback (google/apple)
// -----------------------------------------------------------------------------
type EndpointContextLike =
  | {
      path?: string | undefined;
      body?: { provider?: unknown } | undefined;
    }
  | null
  | undefined;

const detectRegistrationProvider = (ctx: EndpointContextLike): string => {
  const path = typeof ctx?.path === 'string' ? ctx.path : '';
  if (!path) {
    return 'unknown';
  }
  if (path.startsWith('/callback/')) {
    // /callback/google, /callback/apple, …
    return path.slice('/callback/'.length).split('/')[0] || 'oauth';
  }
  if (path.startsWith('/sign-in/social')) {
    const bodyProvider =
      typeof ctx?.body?.provider === 'string' ? ctx.body.provider : null;
    return bodyProvider ?? 'social';
  }
  if (path.includes('magic-link')) {
    return 'magic-link';
  }
  if (path.startsWith('/sign-up/email') || path.startsWith('/sign-in/email')) {
    return 'email';
  }
  return 'unknown';
};

// -----------------------------------------------------------------------------
// refreshAppleClientSecretForPath — Apple JWT auto-refresh (A16), run from
// hooks.before. Apple client_secret is a signed JWT with 180-day lifetime;
// without refresh Apple Sign-In silently breaks after 6 months. On Apple OAuth
// paths the cached JWT is regenerated within 30 days of expiry and the
// provider's `options` are mutated so the token exchange uses the fresh secret.
// -----------------------------------------------------------------------------
const refreshAppleClientSecretForPath = async (
  ctx: GenericEndpointContext
): Promise<void> => {
  const isApplePath =
    (ctx.path.startsWith('/sign-in/social') &&
      ctx.body?.provider === 'apple') ||
    ctx.path.startsWith('/callback/apple');

  if (!isApplePath) {
    return;
  }

  const freshSecret = await getOrRefreshAppleClientSecret();
  if (!freshSecret) {
    return;
  }

  // Mutate the provider's options.clientSecret in-place. Better Auth's Apple
  // provider reads `options.clientSecret` at call time (not captured at
  // construction), so the next token exchange picks it up.
  const providers = ctx.context.socialProviders as
    Array<{ id: string; options?: { clientSecret?: string } }> | undefined;
  const appleProvider = providers?.find(p => p.id === 'apple');
  if (appleProvider?.options) {
    appleProvider.options.clientSecret = freshSecret;
  }
};

// -----------------------------------------------------------------------------
// auth — the shared Better Auth instance.
// -----------------------------------------------------------------------------
export const auth = betterAuth({
  database: prismaAdapter(DB_CLIENT.use, { provider: 'postgresql' }),
  secret: ENV_VARS.BETTER_AUTH_SECRET,
  baseURL: ENV_VARS.BETTER_AUTH_URL,

  // DECISION: CSRF / Origin validation for Better Auth endpoints (`/api/auth/*`).
  // `trustedOrigins` feeds Better Auth's built-in `originCheckMiddleware`
  // (better-auth/dist/api/middlewares/origin-check.mjs), which validates Origin/Referer and
  // callbackURL/redirectURL on EVERY mutating request (POST/PUT/DELETE; GET/OPTIONS are skipped:
  // no ambient credentials, no effects). Mismatch = FORBIDDEN / INVALID_ORIGIN.
  // Trusted: PUBLIC_URL (production frontend), capacitor://localhost (Capacitor WebView),
  // http://localhost (Capacitor Android fallback), http://localhost:3000 (dev only).
  // Browser-cookie sessions are CSRF-protected by this built-in check; the other categories
  // (Bearer, S2S webhook, public no-auth) are covered in application/cors/cors.middleware.ts.
  trustedOrigins: [
    ...new Set([
      ENV_VARS.PUBLIC_URL,
      // DECISION: in sync with the CORS allowlist (FRONTEND_PUBLIC_DOMAIN): Better Auth's origin
      // check MUST trust the same origins as the CORS preflight. Otherwise env drift in prod
      // (PUBLIC_URL != the real frontend origin, e.g. www/trailing slash) gives OPTIONS 204 but
      // POST /api/auth/* 403 INVALID_ORIGIN. Taken from CORS_ALLOWED_ORIGINS, filtered to entries
      // WITH a protocol, because Better Auth compares the full origin (scheme+host[+port]).
      ...CORS_ALLOWED_ORIGINS.filter(o => o.startsWith('http')),
      // Capacitor WebView on iOS / Android (native app shell)
      'capacitor://localhost',
      'http://localhost',
      ...(process.env.NODE_ENV === 'development'
        ? ['http://localhost:3000']
        : []),
    ]),
  ].filter((origin): origin is string => Boolean(origin)),

  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: Math.floor(SESSION_EXPIRES_IN_SECONDS / 2),
    // DECISION: cookieCache is DISABLED (zero-cookie pragmatism, owner decision). The frontend is
    // bearer-only (token in localStorage['authorization'], cookieless WebView), so the
    // `session_data` cache cookie was never read; sessions are always read fresh from the DB via
    // getSession. The BA-core `session_token` cookie is still stamped on sign-in (setSessionCookie,
    // not removable without a fork) and the front IGNORES it. If a Better Auth upgrade makes
    // `setSessionCookie` optional, the `session_token` cookie can go too.
    cookieCache: { enabled: false },
    // Map Better Auth core field names to our Prisma field names
    fields: {
      expiresAt: 'expires',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
    },
    additionalFields: {
      device_type: { type: 'string', required: false, input: false },
    },
  },

  user: {
    // The rationale for the field shapes (including the `role_id.defaultValue` safeguard,
    // without which OAuth sign-up ends in `?error=role_id_is_required`) sits at the
    // definition, user-fields.config.ts.
    additionalFields: USER_ADDITIONAL_FIELDS,
  },

  socialProviders: {
    google: {
      clientId: ENV_VARS.GOOGLE_CLIENT_ID,
      clientSecret: ENV_VARS.GOOGLE_CLIENT_SECRET,
    },
    ...(appleConfig ? { apple: appleConfig } : {}),
  },

  account: buildAccountLinkingOptions(),

  // DECISION: see web-1/src/application/auth/better-auth/client-ip-stamp.ts (stamped IP only).
  ...LOGIN_LIMIT_OPTIONS.betterAuth,

  // DECISION: `account` (account-linking options only) must NOT set `skipStateCookieCheck`. The
  // signed state cookie is the ONLY binding of "the browser finishing the callback is the browser
  // that started the flow" (dist/state.mjs, database branch). Single-use DB state and PKCE do not
  // protect against login-CSRF / session fixation (RFC 6819 §4.4.1.8): a victim could redeem the
  // attacker's state and sign in to the attacker's account. A global skip would weaken that for
  // EVERY Google login, web included. Native OAuth (WebView init, Custom Tab callback = different
  // cookie jars) is solved by starting the flow in the EXTERNAL browser through the backend
  // GET-wrapper `web-1/src/pages/api/auth/native-oauth-start/[provider].ts` (front side:
  // `main/src/application/auth/social-signin.ts`), so the state cookie lives in the callback's jar
  // and the check stays active everywhere (ADR-011).

  // OAuth errors (state_mismatch, provider error, etc.) come back from BA as a 302 to
  // errorURL, which defaults to the BACKEND origin (API-only 404, a dead end for the
  // user). Point it at the frontend login page; BA appends `?error=<code>`.
  onAPIError: {
    errorURL: `${resolveCanonicalFrontendOrigin()}${ROUTES_FRONT_STATIC.USER_LOG}`,
  },

  plugins: [
    bearer(),
    magicLink({
      // Better Auth passes `{ email, url, token }`; our shared adapter uses
      // NextAuth-style `{ identifier, url, token }`. Map email → identifier.
      sendMagicLink: async ({ email, url, token }) => {
        await sendVerificationRequest({
          identifier: email,
          url,
          token,
        });
      },
      expiresIn: 60 * 60, // 1h — matches legacy magic-link TTL
      rateLimit: LOGIN_LIMIT_OPTIONS.magicLink,
    }),
    // NOTE: admin() plugin NOT used — custom impersonation (become-user /
    // switch-back) is preserved. That migration is scoped to WAVE 5.
  ],

  // ---------------------------------------------------------------------------
  // databaseHooks — mirror NextAuth's `events.createUser` + PrismaAdapter
  // session enrichment. Hooks receive the raw model row, so we key off
  // `role_id` / `email` directly rather than going through the session layer.
  // ---------------------------------------------------------------------------
  //
  // DECISION: the config is a god-config with inline side effects (user.create.before: role stamp;
  // user.create.after: welcome email + USER_REGISTERED audit), deliberately, pre-launch. Extracting
  // named domain operations would help testability, but Better Auth hooks are not unit-testable
  // without a full auth instance and the flow is two side effects. A later refactor must be
  // transparent to importers; do not move it piecemeal.
  databaseHooks: {
    user: {
      create: {
        // events.createUser: stamp role_id based on admin allow-list BEFORE
        // the insert so the row lands in the DB with the correct role. This
        // removes the legacy two-step (create → update) pattern.
        before: async user => {
          const email = typeof user.email === 'string' ? user.email : '';
          const roleId: SystemRoleIdType =
            email && isAdminEmail(email)
              ? SystemRoleId.MASTER_ADMIN
              : SystemRoleId.CLIENT_ROLE;
          return {
            data: {
              ...user,
              role_id: roleId,
              account_type: AccountTypeValue.CLIENT,
            },
          };
        },
        // events.createUser (post-insert side effects):
        //   - welcome email (fire-and-forget; errors swallowed inside helper)
        //   - USER_REGISTERED audit log (fire-and-forget; never blocks creation)
        after: async (user, ctx) => {
          if (typeof user.email === 'string' && user.email) {
            const recipient: {
              email: string;
              name?: string | null;
              id?: string;
            } = {
              email: user.email,
              name: typeof user.name === 'string' ? user.name : null,
            };
            if (typeof user.id === 'string' && user.id) {
              recipient.id = user.id;
            }
            await sendTransactionalEmail(
              'welcome',
              recipient,
              APP_EVENTS.INFO.EMAIL.EMAIL_WELCOME_SENT,
              undefined,
              'email.welcome.subject'
            );
          }

          // DECISION: the USER_REGISTERED audit is emitted here (not in handleOAuthCallback)
          // because user.create.after is the SINGLE entry point for every account creation path
          // (email/magic-link, Google, Apple, dev-login); an OAuth-only emission would miss
          // magic-link registrations and any future provider. Better Auth invokes it exactly ONCE
          // per row insert. Fire-and-forget (void + .catch) is mandatory: a throw would propagate
          // through createWithHooks and roll back the user insert, so failures only go to the
          // issue tracker.
          if (typeof user.id === 'string' && user.id) {
            const userId = user.id;
            const provider = detectRegistrationProvider(ctx);
            const headers: Headers | undefined =
              ctx?.request?.headers ?? ctx?.headers;
            const userAgent = headers?.get('user-agent') ?? null;
            const acceptLanguage = headers?.get('accept-language') ?? null;
            const clientIp = headers
              ? extractIpFromFetchHeaders(headers)
              : null;
            const accountType =
              typeof user.account_type === 'string'
                ? user.account_type
                : AccountTypeValue.CLIENT;
            const roleId =
              typeof user.role_id === 'string' ? user.role_id : null;
            const emailVerified = user.emailVerified === true;
            const hasName =
              typeof user.name === 'string' && user.name.length > 0;
            const hasImage =
              typeof user.image === 'string' && user.image.length > 0;

            void writeRawEventLog_IO({
              eventName: APP_EVENTS.INFO.USER.USER_REGISTERED,
              eventLogType: EventLogTypeValue.ACCOUNT,
              meta: {
                created_by_user_id: userId,
                user_agent: userAgent,
                client_ip: clientIp,
                language: acceptLanguage,
              },
              eventPayloadToStringify: {
                provider,
                account_type: accountType,
                role_id: roleId,
                email_verified: emailVerified,
                has_name: hasName,
                has_image: hasImage,
                registration_path: ctx?.path ?? null,
              },
            }).catch((error: unknown) => {
              reportIssueBackend({
                namespace: 'BA_HOOK_USER_REGISTERED',
                message: 'Failed to push USER_REGISTERED event log (swallowed)',
                payload: error,
                mode: 'error',
              });
            });
          }
        },
      },
    },
    session: {
      // PrismaAdapter previously stamped device info via a custom adapter; in
      // Better Auth we hook session.create.after, read Request headers, and
      // update the row we just created.
      create: {
        after: async (session, ctx) => {
          handleSessionCreated(session);

          const headers: Headers | undefined =
            ctx?.request?.headers ?? ctx?.headers;
          if (!headers) {
            return;
          }

          const ua = headers.get('user-agent') ?? null;
          const ip = extractIpFromFetchHeaders(headers);

          try {
            await DB_CLIENT.use.session.update({
              where: { id: session.id },
              data: {
                ip_address: ip,
                user_agent: ua,
                device_type: ua ? parseDeviceType(ua) : null,
              },
            });
          } catch (error) {
            reportIssueBackend({
              namespace: 'AUTH_SESSION_DEVICE_INFO',
              message: 'Failed to stamp device info on new session',
              payload: error,
              mode: 'error',
            });
          }
        },
      },
    },
  },

  // ---------------------------------------------------------------------------
  // hooks.before — Apple JWT auto-refresh (A16, refreshAppleClientSecretForPath)
  // and the WS1 redirect-target normalization.
  // ---------------------------------------------------------------------------
  // hooks.after — global after-middleware for endpoint paths. Semantic 1:1
  // of NextAuth's `events.signIn` / `events.signOut`.
  // ---------------------------------------------------------------------------
  hooks: {
    before: createAuthMiddleware(async ctx => {
      if (APPLE_ENABLED) {
        await refreshAppleClientSecretForPath(ctx);
      }
      // Login limits layer 3 (magic-link send only): throws to refuse.
      await enforceMagicLinkSendGate(ctx);
      // WS1: relative redirect targets become absolute on the front origin
      // (DECISION in auth-redirect-targets.ts). Returning the patched body /
      // query is how Better Auth lets a before-hook change the endpoint input.
      return normalizeAuthRedirectTargets(ctx) ?? undefined;
    }),
    after: createAuthMiddleware(async ctx => {
      if (ctx.path.startsWith('/callback') && ctx.context.newSession) {
        await handleOAuthCallback(ctx);
      }
      // AUTH-MIG variant C — post-login token bridge. Fires on the two cookieless
      // pain-point paths (OAuth callback + magic-link verify) when a FRESH session
      // exists: mints a one-time exchange code and rewrites the 302 Location to the
      // frontend origin + ?authCode. Must run AFTER handleOAuthCallback (which may
      // upgrade the admin role) but is independent of it. See handleLoginTokenBridge.
      const bridged =
        ctx.context.newSession &&
        (ctx.path.startsWith('/callback') ||
          ctx.path.startsWith('/magic-link/verify'))
          ? await handleLoginTokenBridge(ctx)
          : false;
      // WS1 net: a redirect the bridge did not take (every failure) must still
      // end on the front, never on the API origin (auth-redirect-targets.ts).
      if (!bridged) {
        pinFailedRedirectToFrontend(ctx);
      }
      if (ctx.path.startsWith('/sign-out') && ctx.context.session) {
        await handleSignOut(ctx);
      }
      // D2 — Failed login audit. Inspects `ctx.context.returned` for APIError
      // / redirect-with-error on every auth path; emits CANNOT_LOGIN to
      // EventLog. Fire-and-forget; never blocks the auth response.
      handleAuthFailure(ctx);
    }),
  },
});

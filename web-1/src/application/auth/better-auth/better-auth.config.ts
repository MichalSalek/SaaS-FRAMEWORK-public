/**
 * Better Auth configuration (AUTH-MIG WAVE 1).
 *
 * This file is the semantic 1:1 replacement for `pages/api/auth/[...nextauth].ts`
 * under the NextAuth v4 Prisma/Email/Google/Apple stack:
 *
 *   NextAuth v4                 Better Auth
 *   ─────────────────────────── ──────────────────────────────────────────────
 *   callbacks.session           user.additionalFields (role_id, account_type…)
 *   events.signIn               hooks.after (on /callback)
 *   events.signOut              hooks.after (on /sign-out)
 *   events.createUser           databaseHooks.user.create.before/after
 *   EmailProvider               magicLink plugin (reuses magic-link.adapter)
 *   GoogleProvider              socialProviders.google
 *   AppleProvider               socialProviders.apple (feature-flagged)
 *   PrismaAdapter + device info databaseHooks.session.create.after
 *
 * WAVE 1 scope: build `auth` instance + Apple client_secret JWT signer.
 * HANDLER WIRING happens in WAVE 3. Custom admin impersonation is preserved
 * (no `admin()` plugin) — that migrates in WAVE 5.
 *
 * Apple provider is gated on the presence of APPLE_* env vars so the config
 * compiles and runs cleanly in environments without Apple credentials.
 */

import { betterAuth } from 'better-auth';
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
import { buildAccountLinkingOptions } from './account-linking.config';
import { USER_ADDITIONAL_FIELDS } from './user-fields.config';
import {
  handleLoginTokenBridge,
  handleOAuthCallback,
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
// auth — the shared Better Auth instance.
// -----------------------------------------------------------------------------
export const auth = betterAuth({
  database: prismaAdapter(DB_CLIENT.use, { provider: 'postgresql' }),
  secret: ENV_VARS.BETTER_AUTH_SECRET,
  baseURL: ENV_VARS.BETTER_AUTH_URL,

  // DECISION (nie usuwaj tego komentarza):
  // CSRF / Origin validation dla Better Auth endpoints (`/api/auth/*`) — PLQS F4-8:
  // `trustedOrigins` zasila wbudowany `originCheckMiddleware` BA (zob.
  // node_modules/better-auth/dist/api/middlewares/origin-check.mjs). Middleware
  // automatycznie waliduje Origin/Referer header + callbackURL/redirectURL na
  // KAŻDYM mutacyjnym requeście do `/api/auth/*` (POST/PUT/DELETE; GET/OPTIONS
  // pomijane bo bez ambient credentials nie powodują efektów). Mismatch =
  // FORBIDDEN / INVALID_ORIGIN.
  //
  // Lista trusted:
  //   - PUBLIC_URL (production frontend, np. https://nailfolio.app)
  //   - capacitor://localhost — Capacitor WebView na iOS/Android, native shell
  //   - http://localhost — Capacitor Android fallback origin
  //   - http://localhost:3000 — dev frontend (tylko NODE_ENV=development)
  //
  // Kategoria B (browser cookie session) → CSRF chronione przez BA built-in.
  // Pozostałe kategorie (Bearer, S2S webhook, public no-auth) — patrz
  // DECISION w application/cors/cors.middleware.ts.
  trustedOrigins: [
    ...new Set([
      ENV_VARS.PUBLIC_URL,
      // DECISION (nie usuwaj tego komentarza):
      // SYNC z CORS allowlist (FRONTEND_PUBLIC_DOMAIN) — better-auth originCheck
      // MUSI ufać tym samym originom co CORS preflight. Bez tego env-drift na prod
      // (PUBLIC_URL != faktyczny origin frontendu, np. www/trailing-slash) daje
      // OPTIONS 204 (CORS OK) ale POST /api/auth/* -> 403 INVALID_ORIGIN (S37 repro
      // prod: origin https://nailfolio.app odrzucany mimo poprawnego CORS 204, bo
      // PUBLIC_URL != nailfolio.app). Czerpiemy z CORS_ALLOWED_ORIGINS (to samo
      // FRONTEND_PUBLIC_DOMAIN), filtrując do wariantów Z PROTOKOLEM — better-auth
      // porownuje pelny origin (scheme+host[+port]), nie bare-domain.
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
    // DECISION (nie usuwaj tego komentarza):
    // cookieCache DISABLED (zero-cookie pragmatic, decyzja ownera). Eliminuje
    // `session_data` cookie (cache sesji w cookie). Frontend jest bearer-only
    // (token w localStorage['authorization'], cookieless WebView) — cache sesji w
    // cookie był martwym bytem nigdy nie czytanym przez front. Sesja czytana zawsze
    // świeżo z DB via getSession (bearer token → DB lookup). UWAGA: BA-core
    // `session_token` cookie nadal stempluje się przy sign-in (setSessionCookie,
    // nieusuwalne bez forka) — ale front go IGNORUJE (Bearer transport). Wyłączenie
    // tylko cache eliminuje drugi cookie bez ruszania core flow.
    //
    // BA version: 1.6.3 (web-1/package.json). Przy upgrade BA sprawdź czy
    // `setSessionCookie` stało się opcjonalne — jeśli tak, można wyeliminować
    // `session_token` cookie całkowicie bez forka (zero-cookie do końca).
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
    // Uzasadnienie kształtu pól (w tym bezpiecznika `role_id.defaultValue`,
    // bez którego rejestracja przez OAuth kończy się `?error=role_id_is_required`)
    // stoi przy samej definicji — user-fields.config.ts.
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

  // DECISION (nie usuwaj tego komentarza):
  // Powyższe `account` NIE zawiera `skipStateCookieCheck` i nigdy nie ma zawierać
  // (obiekt niesie wyłącznie zasady podpinania kont — account-linking.config.ts).
  // NIE ustawiamy `account.skipStateCookieCheck` — signed state cookie jest
  // JEDYNYM bindem "przeglądarka kończąca callback == przeglądarka, która flow
  // zaczęła" (dist/state.mjs:117, gałąź database). Single-use state w DB i PKCE
  // NIE chronią przed login-CSRF / session-fixation (RFC 6819 §4.4.1.8): ofiara
  // może zredeemować CUDZY state i zalogować się na konto atakującego. Globalny
  // skip osłabiłby to dla KAŻDEGO logowania Google (też web). Natywny OAuth
  // (WebView init → Custom Tab callback = różne cookie-jary) rozwiązujemy przez
  // inicjację flow W ZEWNĘTRZNEJ przeglądarce (backendowy GET-wrapper
  // native-oauth-start), więc state cookie żyje w tym samym jarze co callback i
  // check zostaje aktywny wszędzie. Kanon toru natywnego:
  // `web-1/src/pages/api/auth/native-oauth-start/[provider].ts` (GET-wrapper) plus
  // `main/src/application/auth/social-signin.ts` po stronie frontu.
  // (S113: poprzednia wersja odsyłała do `native-social-signin.ts`, pliku, którego
  // nigdy nie było pod tą nazwą — a to JEDYNY komentarz broniący zakazu
  // `account.skipStateCookieCheck`, więc martwy odsyłacz podkopywał ADR-011.)

  // Błędy OAuth (state_mismatch, provider error itd.) BA zwraca 302 na
  // errorURL — default to origin BACKENDU (api.nailfolio.app → API-only 404,
  // ślepy zaułek dla usera). Kierujemy na stronę logowania frontendu; BA
  // dokleja `?error=<code>` do query.
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
  // DECISION (nie usuwaj tego komentarza):
  // God-config z inline side-effectami (user.create.before: role stamp;
  // user.create.after: welcome email + USER_REGISTERED audit) — CELOWE pre-launch.
  // Ekstrakcja do named domain operations (assignRoleOnCreate,
  // sendWelcomeAndAuditOnRegister) poprawiłaby testowalność, ale ROI jest niski:
  // Better Auth hooks nie są unit-testowalnie (wymagają pełnego auth instance),
  // a flow jest prosty (2 side-effecty). Refaktor odłożony do dedykowanej sesji
  // (po launch), gdzie MUSI być transparentny dla importerów — zero zmian
  // w zachowaniu, tylko reorganizacja. Nie przenoś fragmentarycznie.
  // ---------------------------------------------------------------------------
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

          // DECISION (nie usuwaj tego komentarza):
          // USER_REGISTERED audit emission lives here (not in handleOAuthCallback)
          // because user.create.after is the SINGLE entry point for every account
          // creation path — email/magic-link, Google, Apple, dev-login. Emitting
          // from OAuth-only paths would miss magic-link registrations and any
          // future provider added. Better Auth invokes user.create.after exactly
          // ONCE per row insert (verified against @better-auth/core typings:
          // before/after hooks wrap the createWithHooks atomic operation).
          //
          // Fire-and-forget pattern (void + .catch) is mandatory: a failure to
          // write the audit row MUST NOT abort account creation. The throw would
          // otherwise propagate up through createWithHooks and rollback the user
          // insert. Errors are reported to the issue tracker for visibility.
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
  // hooks.before — Apple JWT auto-refresh (A16).
  //
  // Apple client_secret is a signed JWT with 180-day lifetime. Without
  // refresh, Apple Sign-In silently breaks after 6 months. The before-hook
  // checks the cached JWT's TTL on Apple OAuth paths and regenerates it
  // when it is within 30 days of expiry, mutating the provider's `options`
  // so the token exchange uses the fresh secret.
  // ---------------------------------------------------------------------------
  // hooks.after — global after-middleware for endpoint paths. Semantic 1:1
  // of NextAuth's `events.signIn` / `events.signOut`.
  // ---------------------------------------------------------------------------
  hooks: {
    ...(APPLE_ENABLED
      ? {
          before: createAuthMiddleware(async ctx => {
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

            // Mutate the provider's options.clientSecret in-place. Better
            // Auth's Apple provider reads `options.clientSecret` at call time
            // (not captured at construction), so the next token exchange picks
            // it up.
            const providers = ctx.context.socialProviders as
              | Array<{ id: string; options?: { clientSecret?: string } }>
              | undefined;
            const appleProvider = providers?.find(p => p.id === 'apple');
            if (appleProvider?.options) {
              appleProvider.options.clientSecret = freshSecret;
            }
          }),
        }
      : {}),
    after: createAuthMiddleware(async ctx => {
      if (ctx.path.startsWith('/callback') && ctx.context.newSession) {
        await handleOAuthCallback(ctx);
      }
      // AUTH-MIG variant C — post-login token bridge. Fires on the two cookieless
      // pain-point paths (OAuth callback + magic-link verify) when a FRESH session
      // exists: mints a one-time exchange code and rewrites the 302 Location to the
      // frontend origin + ?authCode. Must run AFTER handleOAuthCallback (which may
      // upgrade the admin role) but is independent of it. See handleLoginTokenBridge.
      if (
        ctx.context.newSession &&
        (ctx.path.startsWith('/callback') ||
          ctx.path.startsWith('/magic-link/verify'))
      ) {
        await handleLoginTokenBridge(ctx);
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

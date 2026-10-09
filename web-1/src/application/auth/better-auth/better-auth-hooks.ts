import type { GenericEndpointContext } from 'better-auth';

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  SystemRoleId,
  type SystemRoleIdType,
} from '@kernel/models/db_models.manual.dto';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

import { isAdminEmail } from '@app/admin/admin.utils.api';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { syncAccountWithStripe } from '@app/stripe/stripe-sync.operations';

import {
  buildBridgeRedirectUrl,
  mintExchangeCode,
  toNativeOAuthReturnIfMarked,
} from './auth-token-bridge';
import { getDispatchResponseHeaders } from './better-auth-dispatch-context';

const SYSTEM_ROLE_ID_VALUES = Object.values(
  SystemRoleId
) as ReadonlyArray<SystemRoleIdType>;

export const readUserRoleId = (user: unknown): SystemRoleIdType | null => {
  if (
    user === null ||
    typeof user !== 'object' ||
    !('role_id' in user) ||
    typeof (user as { role_id: unknown }).role_id !== 'string'
  ) {
    return null;
  }
  const roleId = (user as { role_id: string }).role_id;
  return (SYSTEM_ROLE_ID_VALUES as ReadonlyArray<string>).includes(roleId)
    ? (roleId as SystemRoleIdType)
    : null;
};

export const handleOAuthCallback = async (
  ctx: GenericEndpointContext
): Promise<void> => {
  const newSession = ctx.context?.newSession;
  if (!newSession) {
    return;
  }
  const { user } = newSession;
  const email = typeof user.email === 'string' ? user.email : null;
  const currentRoleId = readUserRoleId(user);

  if (
    email &&
    isAdminEmail(email) &&
    currentRoleId !== SystemRoleId.MASTER_ADMIN
  ) {
    try {
      await DB_CLIENT.use.user.update({
        where: { id: user.id },
        data: { role_id: SystemRoleId.MASTER_ADMIN },
      });
    } catch (error) {
      reportIssueBackend({
        namespace: 'AUTH_SIGNIN_ADMIN_UPGRADE',
        message: 'Failed to upgrade user to MASTER_ADMIN on sign in',
        payload: error,
        mode: 'error',
      });
    }
  }

  void writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.USER.USER_LOGGED_IN,
    eventLogType: EventLogTypeValue.LOGIN,
    meta: { created_by_user_id: user.id },
    eventPayloadToStringify: { email },
  }).catch((error: unknown) => {
    reportIssueBackend({
      namespace: 'BA_HOOK_EVENT_LOG',
      message: 'Failed to push USER_LOGGED_IN event log (swallowed)',
      payload: error,
      mode: 'error',
    });
  });

  try {
    const stylistAccount = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { created_by_user_id: user.id },
      select: { account_id: true },
    });
    if (stylistAccount) {
      await syncAccountWithStripe({
        accountId: stylistAccount.account_id,
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'AUTH_SIGNIN_STRIPE_SYNC',
      message: 'Failed to sync Stripe status on sign in',
      payload: error,
      mode: 'error',
    });
  }
};

/**
 * handleLoginTokenBridge — variant C (exchange-code) post-login token transport.
 *
 * Runs in `hooks.after` for magic-link verify (`/magic-link/verify`) and OAuth
 * callbacks (`/callback/*`) once a FRESH session exists (`ctx.context.newSession`).
 * Better Auth has, at this point, thrown a 302 redirect whose `Location` header
 * lives in `ctx.context.responseHeaders` (resolved against the BACKEND origin).
 *
 * We mint a single-use, 60 s exchange code bound to the new session token, then
 * REWRITE the `Location` header to the FRONTEND origin + `?authCode=<code>` via
 * `ctx.setHeader('location', ...)`. The runner merges hook headers into the final
 * response (overwriting `location`), so the browser navigates to the SPA carrying
 * only the ephemeral code — never the bearer token.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Rewrite redirectu robimy w after-hook (nie bridge-endpoint), bo to czyste i
 * zweryfikowane empirycznie w better-auth 1.6.3: `throw ctx.redirect()` zapisuje
 * `location` w APIError → runner przenosi je do `ctx.context.responseHeaders` →
 * after-hooki dostają do nich dostęp, a `ctx.setHeader('location', x)` z hooka jest
 * mergowany (set, nadpisanie) do finalnych nagłówków (api/to-auth-endpoints.mjs
 * runAfterHooks). Status 302 zachowany (hooki nie ruszają result.status).
 * KRYTYCZNE (Z13 security review 2026-06-04, runtime-probe): `ctx.setHeader` ISTNIEJE
 * WYŁĄCZNIE dlatego, że ten hook jest owinięty w `createAuthMiddleware(...)` w
 * better-auth.config.ts (wstrzykuje better-call context z setHeader). Surowy
 * `hooks.after = async ctx => {}` daje `ctx.setHeader === undefined` → crash w
 * runAfterHooks. NIE odwijać hooka z createAuthMiddleware — cichy revert redirectu
 * na backend origin = regresja loginu (sesja nie przeżyje reloadu).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Dotyczy WYŁĄCZNIE świeżego loginu (newSession). NIE rusza become-user /
 * impersonacji — ta jedzie osobnym kanałem (`become-user` header, opaque HMAC) i
 * nigdy nie przechodzi przez /magic-link/verify ani /callback/*. Brak ryzyka
 * nadpisania aktywnej impersonacji.
 */
export const handleLoginTokenBridge = async (
  ctx: GenericEndpointContext
): Promise<void> => {
  const newSession = ctx.context?.newSession;
  const sessionToken =
    typeof newSession?.session?.token === 'string'
      ? newSession.session.token
      : null;
  const userId =
    typeof newSession?.user?.id === 'string' ? newSession.user.id : null;
  if (!sessionToken || !userId) {
    return;
  }

  const responseHeaders = getDispatchResponseHeaders(ctx);
  const currentLocation = responseHeaders?.get('location') ?? null;
  if (currentLocation === null || currentLocation === '') {
    // No redirect to rewrite (e.g. magic-link verify without callbackURL returns
    // JSON, not a 302). Nothing to bridge — token already returned in JSON body.
    return;
  }

  try {
    const code = await mintExchangeCode(
      ctx.context.internalAdapter,
      sessionToken
    );
    const rewritten = buildBridgeRedirectUrl(currentLocation, code);
    // Native-originated OAuth (gated by NATIVE_DEEPLINK_ENABLED, OAuth /callback
    // only): hand control back to the app via the nailfolio:// custom scheme
    // instead of the https Universal/App Link — an external OAuth browser tab
    // (SFSafariViewController / Custom Tab) will not honor a Universal/App Link
    // on its internal 302. Magic-link verify keeps the https landing (its first
    // tap is already an OS-verified link). Returns null when not native-marked,
    // so web OAuth and magic-link are unaffected. See toNativeOAuthReturnIfMarked.
    const nativeReturn =
      ENV_VARS.NATIVE_DEEPLINK_ENABLED && ctx.path.startsWith('/callback')
        ? toNativeOAuthReturnIfMarked(rewritten)
        : null;
    ctx.setHeader('location', nativeReturn ?? rewritten);

    // Permanent verbose instrumentation (info → gated by VERBOSE_LOG_MODE, see
    // docs/LOGGING.md). Tells us, server-side, whether THIS login handed control
    // back to the native app via the nailfolio:// scheme (native OAuth) or the
    // plain https landing (web / magic-link). No token/code/authCode logged.
    reportIssueBackend({
      namespace: 'AUTH_LOGIN_TOKEN_BRIDGE',
      message: `login bridge: path=${ctx.path}, return=${nativeReturn ? 'nailfolio-scheme' : 'https-landing'}`,
      payload: {
        path: ctx.path,
        nativeSchemeReturn: nativeReturn !== null,
        deeplinkEnabled: ENV_VARS.NATIVE_DEEPLINK_ENABLED,
      },
      mode: 'info',
    });

    void writeRawEventLog_IO({
      eventName: APP_EVENTS.INFO.USER.LOGIN_TOKEN_BRIDGE_MINTED,
      eventLogType: EventLogTypeValue.LOGIN,
      meta: { created_by_user_id: userId },
      eventPayloadToStringify: { path: ctx.path },
    }).catch(() => undefined);
  } catch (error) {
    // Best-effort: if minting fails, leave the original redirect untouched. The
    // user lands on the backend origin (current broken behaviour) rather than a
    // hard error — login itself already succeeded.
    reportIssueBackend({
      namespace: 'AUTH_LOGIN_TOKEN_BRIDGE',
      message: 'Failed to mint/rewrite login token bridge (redirect untouched)',
      payload: error,
      mode: 'error',
    });
  }
};

export const handleSignOut = async (
  ctx: GenericEndpointContext
): Promise<void> => {
  const session = ctx.context?.session;
  if (!session) {
    return;
  }
  const { user } = session;
  const email = typeof user.email === 'string' ? user.email : null;
  void writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.USER.USER_LOGGED_OUT,
    eventLogType: EventLogTypeValue.LOGIN,
    meta: { created_by_user_id: user.id },
    eventPayloadToStringify: { email },
  }).catch((error: unknown) => {
    reportIssueBackend({
      namespace: 'BA_HOOK_EVENT_LOG',
      message: 'Failed to push USER_LOGGED_OUT event log (swallowed)',
      payload: error,
      mode: 'error',
    });
  });

  // DECISION (nie usuwaj tego komentarza):
  // IMPERSONATION KILL-SWITCH ON SIGN-OUT (finding impersonation-l2-7). When a
  // sign-out tears down a session that participates in an active ImpersonationBackup,
  // drop the backup row AND the paired impersonated session. We match on EITHER key
  // because the admin operates THROUGH the impersonated session — the admin's own
  // token is never sent to the client (D23) — so a logout mid-impersonation signs out
  // the TARGET session (user.id = impersonated_user_id, token = impersonated_session_token),
  // NOT the admin:
  //   - impersonated_session_token = <signing-out token> → common case (logout during
  //     impersonation); the session BA just deleted IS the impersonated one.
  //   - admin_user_id = user.id → admin signs out their own original session while a
  //     backup is live; the impersonated session is still alive and MUST be torn down
  //     here, or it orphans for the full 48h session lifetime.
  // The impersonated-session deleteMany is idempotent (no-op when BA already removed it).
  // Done INLINE via DB_CLIENT (NOT importing admin-impersonation.operations /
  // impersonation-backup.utils) to avoid a module cycle: better-auth.config →
  // better-auth-hooks → that ops file → user-session.operations → better-auth.config.
  // Best-effort: a cleanup failure must never break logout. The admin-keyed
  // adminRevokeImpersonationBackup_IO is retained for the future explicit admin-UI revoke.
  try {
    const sessionToken =
      typeof session.session?.token === 'string' ? session.session.token : null;
    const orConditions: Array<
      { admin_user_id: string } | { impersonated_session_token: string }
    > = [{ admin_user_id: user.id }];
    if (sessionToken) {
      orConditions.push({ impersonated_session_token: sessionToken });
    }
    const backup = await DB_CLIENT.use.impersonationBackup.findFirst({
      where: { OR: orConditions },
    });
    if (backup) {
      await DB_CLIENT.use.session.deleteMany({
        where: {
          userId: backup.impersonated_user_id,
          token: backup.impersonated_session_token,
        },
      });
      await DB_CLIENT.use.impersonationBackup.deleteMany({
        where: { ref_id: backup.ref_id },
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'BA_HOOK_IMPERSONATION_KILLSWITCH',
      message: 'Failed to clean impersonation backup on sign-out (swallowed)',
      payload: error,
      mode: 'error',
    });
  }
};

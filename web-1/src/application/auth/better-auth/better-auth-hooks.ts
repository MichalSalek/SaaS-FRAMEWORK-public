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
import { finishAcceptedSalonInvitations } from '@app/interceptors/salon-invitation.gateway';

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
 * Better Auth `session.create.after`: the bookkeeping of a real sign-in. Only Better Auth sign-ins
 * pass this hook (impersonation and dev-login write sessions directly). Nothing here is awaited and
 * nothing throws: a failed write is reported and the login goes on.
 */
export const handleSessionCreated = (session: {
  userId: string;
  createdAt: Date;
}): void => {
  // DECISION: see web-1/src/prisma/schema.prisma (user-last-login-at).
  void DB_CLIENT.use.user
    .updateMany({
      where: { id: session.userId },
      data: { last_login_at: session.createdAt },
    })
    .catch((error: unknown) => {
      reportIssueBackend({
        namespace: 'AUTH_LAST_LOGIN_STAMP',
        message: 'Failed to stamp last_login_at on a new session',
        payload: error,
        mode: 'error',
      });
    });
  // DECISION: see salon-invitation-token.service.ts (accepted invitations attach on sign-in).
  void finishAcceptedSalonInvitations(session.userId, 'sign-in');
};

/**
 * Rewrites the post-login 302 once a fresh session exists (`ctx.context.newSession`).
 * Mints a single-use 60s code and sets Location to the front origin plus `?authCode`,
 * so the browser never carries the bearer token. Returns true when it rewrote Location.
 * DECISION: an after-hook, not a bridge endpoint. The runner merges hook headers and keeps
 * the 302. `ctx.setHeader` exists only inside `createAuthMiddleware` in better-auth.config.ts;
 * a raw hook crashes, and skipping the rewrite sends login back to the API origin.
 * Become-user uses the `become-user` header and never these paths.
 */
export const handleLoginTokenBridge = async (
  ctx: GenericEndpointContext
): Promise<boolean> => {
  const newSession = ctx.context?.newSession;
  const sessionToken =
    typeof newSession?.session?.token === 'string'
      ? newSession.session.token
      : null;
  const userId =
    typeof newSession?.user?.id === 'string' ? newSession.user.id : null;
  if (!sessionToken || !userId) {
    return false;
  }

  const responseHeaders = getDispatchResponseHeaders(ctx);
  const currentLocation = responseHeaders?.get('location') ?? null;
  if (currentLocation === null || currentLocation === '') {
    // No redirect to rewrite (e.g. magic-link verify without callbackURL returns
    // JSON, not a 302). Nothing to bridge — token already returned in JSON body.
    return false;
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
    return true;
  } catch (error) {
    // Best-effort: if minting fails, leave the original redirect untouched; the
    // origin net (auth-redirect-targets.ts) still moves it onto the front, so
    // she lands on the login screen of the app instead of the API's 404.
    reportIssueBackend({
      namespace: 'AUTH_LOGIN_TOKEN_BRIDGE',
      message: 'Failed to mint/rewrite login token bridge (redirect untouched)',
      payload: error,
      mode: 'error',
    });
    return false;
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

  // DECISION: IMPERSONATION KILL-SWITCH ON SIGN-OUT. When a sign-out tears down a session that
  // belongs to an active ImpersonationBackup, drop the backup row AND the paired impersonated
  // session. Match on EITHER key, because the admin operates THROUGH the impersonated session, so
  // a logout mid-impersonation signs out the TARGET session, not the admin:
  //   - impersonated_session_token = <signing-out token>: the common case.
  //   - admin_user_id = user.id: the admin signs out their original session while a backup is
  //     live; the impersonated session MUST be torn down here or it orphans for its full lifetime.
  // The impersonated-session deleteMany is a no-op when BA already removed it. Done INLINE via
  // DB_CLIENT to avoid a module cycle: better-auth.config -> better-auth-hooks -> admin
  // impersonation ops -> user-session.operations -> better-auth.config. Best-effort: a cleanup
  // failure must never break logout.
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

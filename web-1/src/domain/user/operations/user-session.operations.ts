import { resolveRequestEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { SESSION_EXPIRES_IN_SECONDS } from '@kernel/application/auth/auth.config';
import { parseDeviceType } from '@app/auth/session/parse-device-type';
import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { IDType } from '@kernel/application/application.types';
import type { Session, User } from '@kernel/models/db_models.generated.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AuthUnavailableStage,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import type {
  AnonymousCurrentUserOutput,
  CurrentUserResolution,
} from '@domain/user/user.types';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { isAPIError } from 'better-auth/api';
import { makeCurrentUser } from '@domain/user/user.utils.api';
import { getUser_IO } from './user-crud.operations';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';
import { auth } from '@app/auth/better-auth/better-auth.config';

/**
 * Session reads go through Better Auth (`auth.api.getSession`): bearer tokens,
 * the OAuth session cookie, refresh (`session.updateAge`) and expiry.
 * createManualSessionForUser_IO, deleteSessionByToken_IO, deleteAllSessionsOfUser_IO,
 * deleteSession_IO and getAllSessionsOfUser_IO stay for admin impersonation and
 * dev-login, which bypass Better Auth sign-in on purpose.
 */

export const getCurrentUserUndefinedReturnObject: AnonymousCurrentUserOutput = {
  user: undefined,
  currentUser: undefined,
  session: undefined,
};

const ANONYMOUS: CurrentUserResolution = {
  status: 'ANONYMOUS',
  output: getCurrentUserUndefinedReturnObject,
};

const unavailable = (
  stage: AuthUnavailableStage,
  error: unknown
): CurrentUserResolution => {
  reportIssueBackend({
    namespace: 'AUTH_UNAVAILABLE',
    message: `Current user could not be resolved (stage ${stage}); answering 503, token kept`,
    payload:
      error instanceof Error
        ? { stage, message: error.message, stack: error.stack }
        : { stage, error: String(error) },
    mode: 'error',
  });
  return { status: 'UNAVAILABLE', stage };
};

/**
 * Better Auth refusing the session itself (a 4xx APIError, e.g. the session row vanished between
 * read and refresh) is an honest "no session". Everything else it throws (it wraps adapter and
 * database failures in a 500 APIError) is an infrastructure failure, not a verdict on the token.
 */
const isBetterAuthSessionRefusal = (error: unknown): boolean =>
  isAPIError(error) && error.statusCode >= 400 && error.statusCode < 500;

/**
 * Get current user from session (Better Auth — bearer token OR cookie).
 *
 * OPTIMIZATION: after BA returns a user id, we still hit our DB for the full
 * `UserWithRelations` shape (`minimal` relations) because the CurrentUser that
 * downstream permission wiring relies on needs `stylist_account` / `client_account`.
 * BA's `user` object only carries the core fields + additionalFields.
 *
 * Never throws. Outcomes: see the DECISION at `CurrentUserResolution` (user.types.ts).
 */
export const getCurrentUser_IO = async (props: {
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<CurrentUserResolution> => {
  let result: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    result = await auth.api.getSession({
      headers: new Headers(props.req.headers as HeadersInit),
    });
  } catch (error) {
    if (isBetterAuthSessionRefusal(error)) {
      return ANONYMOUS;
    }
    return unavailable('SESSION', error);
  }

  if (!result?.user?.id) {
    return ANONYMOUS;
  }

  // Fetch UserWithRelations (stylist_account / client_account are required
  // for permission wiring and account guards downstream).
  let user: UserWithRelations | null;
  try {
    user = await getUser_IO({
      props: { id: result.user.id },
      withRelations: 'minimal',
    });
  } catch (error) {
    return unavailable('USER', error);
  }

  // A confirmed session whose user row is gone: the credentials no longer
  // resolve to anybody, an honest 401.
  if (!user) {
    return ANONYMOUS;
  }

  // DECISION: no salon-invitation attachment and no cache here. Attaching accepted invitations runs on
  // the events that create the need (invitation acceptance, stylist onboarding, every Better Auth
  // sign-in, the team screen; see salon-invitation-token.service.ts), not on every request. The
  // effective plan is read live on every request (one SQL) so a revoke or downgrade is seen by the
  // very next request in any process; caching it would reopen that window.
  if (user.stylist_account) {
    // The effective plan decides plan-gated capabilities downstream; serving
    // the request on the own plan alone would silently drop a salon grant.
    try {
      Object.assign(
        user.stylist_account,
        await resolveRequestEffectivePlan_IO({
          userId: user.id,
          ownPlan: user.stylist_account.pricing_plan,
        })
      );
    } catch (error) {
      return unavailable('PLAN', error);
    }
  }

  const baSession = result.session as unknown as Record<string, unknown>;
  const toDateOrNow = (v: unknown): Date => {
    if (v instanceof Date) {
      return v;
    }
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  };
  const mappedSession: Session = {
    id: result.session.id,
    token: result.session.token,
    userId: user.id,
    // BA exposes `expiresAt` on its runtime shape; our Prisma column is
    // `expires` (mapped via `session.fields.expiresAt` in better-auth.config).
    expires: toDateOrNow(baSession.expiresAt ?? baSession.expires),
    ip_address:
      typeof baSession.ipAddress === 'string'
        ? baSession.ipAddress
        : typeof baSession.ip_address === 'string'
          ? baSession.ip_address
          : null,
    user_agent:
      typeof baSession.userAgent === 'string'
        ? baSession.userAgent
        : typeof baSession.user_agent === 'string'
          ? baSession.user_agent
          : null,
    device_type:
      typeof baSession.device_type === 'string' ? baSession.device_type : null,
    createdAt: toDateOrNow(baSession.createdAt),
    updatedAt: toDateOrNow(baSession.updatedAt),
  };

  return {
    status: 'AUTHENTICATED',
    output: {
      user,
      currentUser: makeCurrentUser({ user, session: mappedSession }),
      session: mappedSession,
    },
  };
};

/**
 * Delete specific session by token.
 * Used internally for admin impersonation cleanup.
 * For regular user logout, Better Auth's `/api/auth/sign-out` handles it.
 */
export const deleteSessionByToken_IO = async (props: {
  payload: { id: IDType; token: string };
}) => {
  await DB_CLIENT.use.session.deleteMany({
    where: {
      userId: props.payload.id,
      token: props.payload.token,
    },
  });
};

/**
 * Create a session row directly in the DB (dev-login + admin impersonation).
 * Bypasses Better Auth's sign-in flow on purpose — these are privileged
 * server-side operations, not user-initiated logins.
 */
export const createManualSessionForUser_IO = async ({
  id,
  ip,
  userAgent,
}: {
  id: User['id'];
  ip: string | null;
  userAgent: string | null;
}): Promise<OperationResult<Session, DatabaseError>> => {
  if (!id) {
    return failure({
      type: 'DATABASE_ERROR',
      operation: 'createManualSessionForUser: Cannot create session without id',
    });
  }

  const expires = new Date(Date.now() + 1000 * SESSION_EXPIRES_IN_SECONDS);
  const token = crypto.randomBytes(32).toString('hex');
  const deviceType = parseDeviceType(userAgent);

  try {
    const session = (await DB_CLIENT.use.session.create({
      data: {
        token,
        expires,
        userId: id,
        ip_address: ip,
        user_agent: userAgent,
        device_type: deviceType,
      },
    })) as Session;

    return success(session);
  } catch (error) {
    return databaseFailure('createManualSessionForUser_IO', error);
  }
};

// DECISION: an impersonation session is INVISIBLE to the account owner. become-user mints a session with
// userId = target (the admin acts THROUGH her), so without the filter the target saw it in SESSION_GET_ALL
// as "another device" and could delete it via SESSION_DELETE_EXACTLY, which broke the admin's switch-back
// (the backup ties the return to impersonated_session_token). Hidden: sessions whose token is the
// impersonated_session_token of a LIVE ImpersonationBackup row (expires_at > now), i.e. exactly as long
// as the return contract exists; afterwards the 48h session is an ordinary foreign bearer and MUST be
// visible and deletable. Exception: the session the caller asks through (the admin mid-impersonation)
// stays and shows as is_current. Deleting a hidden session answers like an unknown id (success(null) ->
// CANNOT_DELETE_SESSION), no existence oracle. The table is read inline (like impersonation-eviction.ts)
// to avoid a user -> admin module cycle. No index on impersonated_user_id on purpose: at most one row per
// admin.
const hiddenImpersonationSessionTokens = async ({
  userId,
  viewerSessionToken,
  now,
}: {
  userId: string;
  viewerSessionToken: string | undefined;
  now: Date;
}): Promise<string[]> => {
  const rows = await DB_CLIENT.use.impersonationBackup.findMany({
    where: { impersonated_user_id: userId, expires_at: { gt: now } },
    select: { impersonated_session_token: true },
    take: 100,
  });
  return rows
    .map(row => row.impersonated_session_token)
    .filter(token => token !== viewerSessionToken);
};

const excludeTokens = (tokens: string[]): { token?: { notIn: string[] } } =>
  tokens.length > 0 ? { token: { notIn: tokens } } : {};

// DECISION: cursor format gate (`isValidCursorFormat` in @kernel validation.utils, the SSOT for both call
// sites). This operation returns a plain pagination shape (not OperationResult) and its HTTP handler
// belongs to another cluster, so a 400 cannot be returned from here without changing the contract.
// Graceful degradation (malformed or foreign cursor => first page) is the complete fix: no existence bit
// leaks and a client with a broken cursor gets a usable first page instead of an error.

export const getAllSessionsOfUser_IO = async ({
  id,
  cursor,
  take = 50,
  viewerSessionToken,
}: Pick<User, 'id'> & {
  cursor?: string;
  take?: number;
  /** Token of the session the caller is using; never hidden from the caller. */
  viewerSessionToken?: string;
}): Promise<{ sessions: Session[]; nextCursor: string | null }> => {
  const effectiveTake = Math.min(Math.max(take, 1), 100);
  const now = new Date();
  // Impersonation sessions are hidden from the account owner — see the DECISION at
  // hiddenImpersonationSessionTokens. Applied to the cursor anchor too, so a hidden
  // session id behaves like a fabricated cursor (first page).
  const hiddenTokenFilter = excludeTokens(
    await hiddenImpersonationSessionTokens({
      userId: id,
      viewerSessionToken,
      now,
    })
  );

  // DECISION: existence-oracle hardening. Prisma `cursor` anchors a row by PK across the WHOLE table BEFORE
  // `where: { userId }` filters the result set, so a victim's cuid and a fabricated one gave different
  // results (a 1-bit "does this session.id exist anywhere" oracle). The cursor is used ONLY when (a) its
  // format is valid, (b) the anchor belongs to the caller (composite WHERE id + userId) and (c) the anchor
  // is still live (expires > now, consistent with the list filter). Otherwise it is ignored and the first
  // page served, so victim cursor == fake cursor == own filtered-out cursor. Cost: one extra indexed PK
  // lookup only when a cursor is passed.
  let anchorCursor: string | undefined = undefined;
  if (cursor && isValidCursorFormat(cursor)) {
    const owns = await DB_CLIENT.use.session.findFirst({
      where: {
        id: cursor,
        userId: id,
        expires: { gt: now },
        ...hiddenTokenFilter,
      },
      select: { id: true },
    });
    if (owns) {
      anchorCursor = cursor;
    }
  }

  const rows = (await DB_CLIENT.use.session.findMany({
    where: {
      userId: id,
      // Only LIVE sessions — expired rows are dead weight for the device list
      // (expiredSessionCleanupInterceptor deletes them anyway; Better Auth never
      // resurrects an expired session, it only checks expiry on read).
      expires: { gt: now },
      ...hiddenTokenFilter,
    },
    // Newest expiry first = most recently active device on top. Cursor field (id)
    // MUST be part of orderBy for stable pagination — `expires` is non-unique
    // (multiple sessions can share an expiry), so id is the tiebreaker preventing
    // cursor+skip from skipping/duplicating rows on page boundaries.
    orderBy: [{ expires: 'desc' }, { id: 'asc' }],
    take: effectiveTake + 1,
    ...(anchorCursor ? { cursor: { id: anchorCursor }, skip: 1 } : {}),
  })) as Session[];

  const hasMore = rows.length > effectiveTake;
  const sessions = hasMore ? rows.slice(0, effectiveTake) : rows;
  const nextCursor =
    hasMore && sessions.length > 0
      ? (sessions[sessions.length - 1]?.id ?? null)
      : null;

  return { sessions, nextCursor };
};

// DECISION: the identifier is Session.id (DB PK), never the token; the token never appears in an HTTP
// body (request) or response (GET_ALL). Defense in depth: composite WHERE (id + userId), so knowing
// someone else's session.id is not enough. deleteMany, not delete: Prisma delete() needs a unique
// constraint and {id + userId} is not a declared composite unique; deleteMany is atomic and returns
// {count} (0 on no match). One row is pre-fetched only to return the full Session for the audit log.
export const deleteSession_IO = async ({
  session_id,
  id,
  viewerSessionToken,
}: {
  id: User['id'];
  session_id: string;
  /** Token of the session the caller is using; never hidden from the caller. */
  viewerSessionToken?: string;
}): Promise<OperationResult<Session | null, DatabaseError>> => {
  if (!session_id || !id) {
    return success(null);
  }

  try {
    // A live impersonation session is not the owner's to delete: it resolves exactly
    // like an unknown id (DECISION at hiddenImpersonationSessionTokens).
    const hiddenTokenFilter = excludeTokens(
      await hiddenImpersonationSessionTokens({
        userId: id,
        viewerSessionToken,
        now: new Date(),
      })
    );
    const row = (await DB_CLIENT.use.session.findFirst({
      where: {
        id: session_id,
        userId: id,
        ...hiddenTokenFilter,
      },
    })) as Session | null;

    if (!row) {
      return success(null);
    }

    const result = await DB_CLIENT.use.session.deleteMany({
      where: {
        id: session_id,
        userId: id,
        ...hiddenTokenFilter,
      },
    });

    if (result.count === 0) {
      return success(null);
    }

    return success(row);
  } catch (error: unknown) {
    if (isP2025(error)) {
      return success(null);
    }
    return databaseFailure('deleteSession', error);
  }
};

export const deleteAllSessionsOfUser_IO = async ({
  id,
}: Pick<User, 'id'>): Promise<
  OperationResult<{ deletedCount: number }, DatabaseError | ValidationError>
> => {
  if (!id) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'id',
      message: 'User id is required to delete sessions',
    });
  }

  try {
    const result = await DB_CLIENT.use.session.deleteMany({
      where: { userId: id },
    });
    // Eviction cleanup: "log out everywhere" by a mid-impersonation admin must also
    // tear down the orphaned impersonated (target) session + backup (connected-dots l2-7).
    await revokeImpersonationOnEviction(id);
    return success({ deletedCount: result.count });
  } catch (error) {
    return databaseFailure('deleteAllSessionsOfUser_IO', error);
  }
};

import type { NextApiRequest, NextApiResponse } from 'next';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { SESSION_HEADER_NAME } from '@app/auth/session/session.utils.api';
import { DB_CLIENT } from '@app/db/db.client';
import { getClientInfoFromReq } from '@app/http/extract-client-info';
import { setClientHeader } from '@app/headers/headers.utils';
import type { IDType } from '@kernel/application/application.types';
import type { Session } from '@kernel/models/db_models.generated.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import type {
  CurrentUser,
  UserWithRelations,
} from '@kernel/models/user/user.types';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { makeCurrentUser } from '@domain/user/user.utils.api';
import { createManualSessionForUser_IO } from '@domain/user/operations/user-session.operations';
import { getUser_IO } from '@domain/user/operations/user-crud.operations';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import {
  resolveBecomeUserTarget_IO,
  requireAdminSessionNotExpired,
} from './admin-impersonation.guards';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
  AdminTargetProtectedError,
} from '@kernel/domain/admin/admin-errors.types';
import type {
  DatabaseError,
  SerializationConflictError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { cleanupImpersonationSession } from '@domain/admin/admin.utils.api';
import { impersonationAuditRow } from './admin-impersonation.audit';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import {
  issueImpersonationBackup,
  refreshImpersonationBackup,
  verifyImpersonationBackup,
  claimImpersonationBackupByRefId,
} from '@domain/admin/impersonation-backup.utils';

type BecomeUserResponse = OperationResult<
  GetCurrentUserOutputOptimistic & { user: UserWithRelations },
  | AdminInsufficientPermissionsError
  | AdminTargetNotFoundError
  | AdminTargetProtectedError
  | DatabaseError
  | SerializationConflictError
>;

/**
 * Admin becomes another user (impersonation)
 */
export const adminBecomeUser_IO = async ({
  body,
  currentUser,
  session,
  metadata: _metadata,
  req,
  res,
}: {
  body: { id: IDType };
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  session: Session;
  metadata: Partial<UserMetadata>;
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<BecomeUserResponse> => {
  // Check permission of current user to become someone else
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // Resolve + guard the impersonation target: self-become reject, no nested
  // impersonation (caller mid-impersonation), target existence, and no admin-on-
  // admin impersonation — all with the exact original order/errors. Full DECISION
  // rationale lives in resolveBecomeUserTarget (admin-impersonation.guards.ts).
  const targetResult = await resolveBecomeUserTarget_IO({
    callerId: currentUser.id,
    targetId: body.id,
    sessionToken: session.token,
  });
  if (!targetResult.success) {
    return targetResult;
  }
  const userToBecome = targetResult.data;

  // Create new session for the target user FIRST — the backup row must persist
  // this exact session token so switch-back / refresh can bind the redeemer to
  // it (caller binding). Ordering: target session →
  // backup (with both admin + impersonated identity) → headers.
  const { ip, userAgent } = getClientInfoFromReq(req.headers);

  const sessionResult = await createManualSessionForUser_IO({
    id: userToBecome.id,
    ip,
    userAgent,
  });

  if (!sessionResult.success) {
    return sessionResult;
  }

  const newSession = sessionResult.data;

  // DECISION: the admin session token never reaches a client header; the `become-user` header
  // carries only an opaque HMAC-signed <ref_id>.<expires_at_ms>.<hmac> (see
  // issueImpersonationBackup in web-1/src/domain/admin/impersonation-backup.utils.ts).
  // DECISION: of two concurrent become-user calls by one admin the loser aborts with 40001
  // (Serializable tx in issueImpersonationBackup, see impersonation-backup.utils.ts). The loser's
  // target session was minted above, outside the tx, and the helper deletes it on conflict;
  // otherwise it would live 48h referenced by no backup row.
  let opaqueToken: string;
  try {
    ({ opaqueToken } = await issueImpersonationBackup({
      adminUserId: currentUser.id,
      backupSessionToken: session.token,
      originalSessionId: session.id,
      impersonatedUserId: userToBecome.id,
      impersonatedSessionToken: newSession.token,
    }));
  } catch (error) {
    // The orphaned target session was already cleaned inside issueImpersonationBackup.
    if (!isSerializationConflict(error)) {
      throw error;
    }
    // DECISION: a 40001 here is a lost race between two concurrent become-user calls, a retryable
    // conflict, not a server fault: return SERIALIZATION_CONFLICT (HTTP 409, error-mapper.ts), not
    // databaseFailure (opaque 500). Other DB errors rethrow above to the handler's 500 path.
    return failure({ type: 'SERIALIZATION_CONFLICT' });
  }

  setClientHeader({
    req,
    res,
    payload: {
      name: SWITCH_BACK_TOKEN_NAME,
      value: opaqueToken,
    },
  });

  setClientHeader({
    req,
    res,
    payload: {
      name: SESSION_HEADER_NAME,
      value: newSession.token,
    },
  });

  const currentUserToBecome = makeCurrentUser({
    user: userToBecome,
    session: newSession,
  });

  // Admin email is NOT in the payload (PII minimization, DECISION in the helper).
  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE,
    ...impersonationAuditRow({
      adminUserId: currentUser.id,
      payload: { target_id: userToBecome.id, original_session_id: session.id },
    }),
  });

  return success({
    user: userToBecome,
    currentUser: currentUserToBecome,
    session: newSession,
  });
};

/**
 * Refresh become-user token (extend impersonation timeout)
 */
export const adminRefreshImpersonation_IO = async ({
  currentUser,
  backupHeaderRaw,
  req,
  res,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  backupHeaderRaw: string;
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<
  OperationResult<
    { expiresAt: number },
    ValidationError | AdminInsufficientPermissionsError
  >
> => {
  // DECISION: verify the opaque token (HMAC + DB lookup) before trusting anything from the header.
  // The caller is on the impersonated session, so the admin is identified only by the DB-backed
  // `admin_user_id`, never by the header.
  const backup = await verifyImpersonationBackup(backupHeaderRaw);

  if (!backup) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Invalid or expired backup token',
    });
  }

  // DECISION: the redeem is bound to the impersonated target (caller must be `impersonated_user_id`
  // AND be on `impersonated_session_token`), not to "anyone who is not the admin"; rationale in
  // web-1/src/domain/admin/impersonation-backup.utils.ts (caller binding).
  if (
    currentUser.id !== backup.impersonated_user_id ||
    currentUser.session.token !== backup.impersonated_session_token
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Caller must be the impersonated target',
    });
  }

  // SECURITY: backup_session_token MUST still belong to backup.admin_user_id.
  // Cast bridges Prisma's raw model type to the generated Session DTO (branded
  // IDType/DateAndTime fields) consumed below — not type suppression.
  const originalUserSession = (await DB_CLIENT.use.session.findUnique({
    where: { token: backup.backup_session_token },
  })) as Session | null;

  if (
    !originalUserSession ||
    originalUserSession.userId !== backup.admin_user_id
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Backup session does not belong to claimed user',
    });
  }

  // Validate that the backup belongs to an admin
  const originalUser = await getUser_IO({
    props: { id: backup.admin_user_id },
    withRelations: false,
  });

  const refreshCheck = requireAdminPermission(originalUser);
  if (!refreshCheck.success) {
    return refreshCheck;
  }

  const expiryCheck = requireAdminSessionNotExpired(originalUserSession);
  if (!expiryCheck.success) {
    return expiryCheck;
  }

  // Issue new opaque token (re-bound HMAC over fresh expires_at).
  const refreshed = await refreshImpersonationBackup({ refId: backup.ref_id });

  if (!refreshed) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Backup vanished during refresh',
    });
  }

  setClientHeader({
    req,
    res,
    payload: {
      name: SWITCH_BACK_TOKEN_NAME,
      value: refreshed.opaqueToken,
    },
  });

  // Prolonging an impersonation is as audit-worthy as starting or ending one:
  // without this row the trail shows a 12h window that silently became longer.
  // Actor = the ADMIN from the DB-backed backup row, never the impersonated caller.
  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ADMIN.IMPERSONATION_REFRESHED,
    ...impersonationAuditRow({
      adminUserId: backup.admin_user_id,
      payload: {
        target_id: backup.impersonated_user_id,
        expires_at: refreshed.expiresAt.toISOString(),
      },
    }),
  });

  return success({ expiresAt: refreshed.expiresAt.getTime() });
};

/**
 * Admin switches back to their original account
 */
export const adminSwitchBackToSelf_IO = async ({
  currentUser,
  backupHeaderRaw,
  _metadata: _unusedMetadata,
  req,
  res,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  backupHeaderRaw: string;
  _metadata: Record<string, unknown>;
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<
  OperationResult<
    CurrentUser,
    | ValidationError
    | AdminTargetNotFoundError
    | AdminInsufficientPermissionsError
  >
> => {
  const cleanup = (refIdToDelete?: string) =>
    cleanupImpersonationSession({
      currentUserId: currentUser.id,
      currentSessionToken: currentUser.session.token,
      ...(refIdToDelete !== undefined && { refIdToDelete }),
      req,
      res,
    });

  const backup = await verifyImpersonationBackup(backupHeaderRaw);

  // DECISION: an unrecognized or expired token is a reject-only no-op; never call cleanup() here.
  // cleanup() without a refId still deletes the CALLER's own session, and SWITCH_BACK_BECOME_USER is
  // in LOGGED_USER_PERMISSIONS, so any user sending a garbage `become-user` header would log
  // themselves out; an admin whose 12h backup expired while the 48h impersonated session lives
  // would be force-logged-out with no way home. The SWITCH_BACK header is not cleared either (a
  // leaked header must not strip a legit admin's exit token). The daily sweep reclaims expired rows.
  if (!backup) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Invalid or expired backup token',
    });
  }

  // DECISION: same caller binding as refresh (impersonated target on the impersonated session).
  // On a binding failure do NOT call cleanup(): cleanup(ref_id) would delete the legit admin's
  // backup row, so anyone who leaked the header could lock the real admin out of switch-back.
  // Reject only; the caller's session is not the impersonated one and stays.
  if (
    currentUser.id !== backup.impersonated_user_id ||
    currentUser.session.token !== backup.impersonated_session_token
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Caller must be the impersonated target',
    });
  }

  const originalUser = await getUser_IO({
    props: { id: backup.admin_user_id },
    withRelations: true,
  });

  if (!originalUser) {
    await cleanup(backup.ref_id);
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: backup.admin_user_id,
      targetType: 'USER',
    });
  }

  // Double check permission of original user
  const switchBackCheck = requireAdminPermission(originalUser);
  if (!switchBackCheck.success) {
    await cleanup(backup.ref_id);
    return switchBackCheck;
  }

  // Cast bridges Prisma's raw model type to the generated Session DTO (branded
  // IDType/DateAndTime fields) consumed below — not type suppression.
  const originalUserSession = (await DB_CLIENT.use.session.findUnique({
    where: {
      token: backup.backup_session_token,
    },
  })) as Session | null;

  if (!originalUserSession) {
    await cleanup(backup.ref_id);
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: backup.admin_user_id,
      targetType: 'USER',
    });
  }

  // SECURITY: backup_session_token MUST actually belong to backup.admin_user_id.
  if (originalUserSession.userId !== backup.admin_user_id) {
    await cleanup(backup.ref_id);
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Backup session does not belong to claimed user',
    });
  }

  // Also reject expired admin sessions: without this check, a long
  // impersonation (>48h, beyond SESSION_EXPIRES_IN_SECONDS) returns the expired
  // token in the response header and the next BA call rejects with a mystery 401.
  // Fail fast (shared guard); cleanup first — switch-back tears the trap down.
  const switchBackExpiry = requireAdminSessionNotExpired(originalUserSession);
  if (!switchBackExpiry.success) {
    await cleanup(backup.ref_id);
    return switchBackExpiry;
  }

  // DECISION: consumption is the gate, see claimImpersonationBackupByRefId in
  // web-1/src/domain/admin/impersonation-backup.utils.ts. The checks above only read the row, so
  // concurrent switch-backs all pass them; losers reject without restoring the header or writing a
  // duplicate USER_SWITCHED_BACK_TO_SELF audit row.
  // Test: web-1/src/domain/admin/operations/admin-impersonation.switch-back.test.ts (covers a lost claim, mocked, rejecting without restore or audit; not a real concurrent claim)
  const claimed = await claimImpersonationBackupByRefId(backup.ref_id);
  if (!claimed) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Invalid or expired backup token',
    });
  }

  // Tear down the impersonated session + clear the SWITCH_BACK header. Pass NO
  // refId — the backup row was already consumed by the claim above, so
  // cleanup() must not attempt a second delete. deleteSessionByToken_IO is
  // scoped to the impersonated caller's id + token.
  await cleanup();

  // Restore original session in the response header
  setClientHeader({
    req,
    res,
    payload: {
      name: SESSION_HEADER_NAME,
      value: originalUserSession.token,
    },
  });

  const currentUserRestored = makeCurrentUser({
    user: originalUser,
    session: originalUserSession,
  });

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ADMIN.USER_SWITCHED_BACK_TO_SELF,
    ...impersonationAuditRow({
      adminUserId: originalUser.id,
      payload: {
        original_id: originalUser.id,
        impersonated_id: currentUser.id,
      },
    }),
  });

  return success(currentUserRestored);
};

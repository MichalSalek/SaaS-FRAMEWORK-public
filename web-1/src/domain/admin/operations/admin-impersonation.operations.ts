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
  // it (caller-binding, admin-impersonation-1). Ordering: target session →
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

  // DECISION (nie usuwaj tego komentarza):
  // D23 (run 25): the admin session token is NEVER serialized into a client
  // header. We persist it server-side in ImpersonationBackup and return only
  // an opaque, HMAC-signed reference. The opaque token in the `become-user`
  // header carries: <ref_id>.<expires_at_ms>.<hmac>. An attacker reading
  // request logs/network traffic learns nothing about the admin session.
  //
  // CALLER-BINDING (admin-impersonation-1): we ALSO persist the impersonated
  // target id + the freshly-minted target session token. switch-back / refresh
  // require the caller to BE that target ON that session — so a leaked opaque
  // header is useless to anyone who isn't the impersonated user on the exact
  // impersonated session.
  // DECISION (nie usuwaj tego komentarza):
  // CONCURRENT BECOME-USER GUARD (impersonation-concurrent-toctou). issueImpersonationBackup
  // serializes the prior-session cleanup + backup upsert (Serializable tx); two simultaneous
  // become-user calls by THIS admin abort the loser (40001 → isSerializationConflict). The
  // loser's target session was minted above (outside the tx), so on conflict we MUST delete it
  // or it orphans (live 48h, referenced by no backup row, never swept). Non-conflict rethrows.
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
    // DECISION (nie usuwaj tego komentarza):
    // admin-impersonation-1: a 40001 here means TWO concurrent become-user calls by this
    // admin raced and this one lost. That is a transient, retryable write-write conflict —
    // NOT a server fault — so we return the generic SERIALIZATION_CONFLICT (→ HTTP 429
    // "retry", error-mapper.ts) instead of databaseFailure (which would have surfaced a
    // misleading opaque 500). databaseFailure is RETAINED for genuine non-serialization DB
    // errors (those rethrow above and bubble to the handler's own 500 path).
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
  // DECISION (nie usuwaj tego komentarza):
  // Verify the opaque token (HMAC + DB lookup) BEFORE trusting anything from
  // the header — caller may be on an impersonated session, so we identify the
  // admin via the DB-backed `admin_user_id` column, never from the header itself.
  const backup = await verifyImpersonationBackup(backupHeaderRaw);

  if (!backup) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Invalid or expired backup token',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // CALLER-BINDING (QA admin-impersonation-1, CRITICAL). The redeem MUST be
  // bound to the impersonated target, NOT merely "anyone who is not the admin".
  // The old `currentUser.id !== backup.admin_user_id` check perversely let ANY
  // OTHER authenticated user who leaked the opaque `become-user` header redeem
  // the admin (MASTER_ADMIN) session. We now require BOTH:
  //   1. caller IS the impersonated target (currentUser.id === impersonated_user_id)
  //   2. caller is ON the exact session minted for this impersonation
  //      (currentUser.session.token === impersonated_session_token)
  // Both come from server-side DB columns set in adminBecomeUser_IO — never from
  // the header — so a leaked opaque token is worthless without ALSO being that
  // user on that session. LEGIT flow is preserved: a real impersonation replays
  // its own target session token, so the genuine target passes both checks.
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

  // DECISION (nie usuwaj tego komentarza):
  // REJECT EXPIRED ADMIN SESSION (parytet z switch-back, DD2-M5 r28). Bez tego
  // refresh przedłuża backup TTL w nieskończoność mimo że return-session admina już
  // wygasła (>48h) — switch-back i tak odrzuci wygasłą sesję, więc rotowanie backupu
  // utrzymuje impersonację, z której NIE DA SIĘ wrócić. Fail-fast; sesja odbita
  // zostaje do sweepa / switch-backowego cleanupu (refresh nie sprząta stanu).
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

  // DECISION (nie usuwaj tego komentarza):
  // !backup = malformed / HMAC-fail / expired / unknown opaque token. We MUST
  // NOT call cleanup() here (findings impersonation-l2-2 footgun + l2-5):
  //   - cleanup() with no refId still runs deleteSessionByToken_IO on the CALLER's
  //     own (id + session.token), hard-deleting the caller's session. SWITCH_BACK
  //     is in LOGGED_USER_PERMISSIONS, so ANY logged-in user sending a garbage
  //     `become-user` header would self-destruct their own session (footgun).
  //   - For a genuine admin whose 12h backup TTL expired while the 48h impersonated
  //     session is still alive, verify returns null and the old cleanup() would
  //     destroy that still-live impersonated session → admin force-logged-out with
  //     no API path home (l2-5 state-trap).
  // An unrecognized/expired token is a no-op rejection — mirror the binding-failure
  // branch below (also reject-only, no cleanup). We do NOT clear the SWITCH_BACK
  // header either: same rationale as binding-failure — clearing on every bad token
  // would let an attacker who leaked the header strip a legit admin's exit token.
  // The 24h sweep interceptor reclaims any truly-expired backup row.
  if (!backup) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Invalid or expired backup token',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // CALLER-BINDING (QA admin-impersonation-1, CRITICAL). Same positive binding
  // as refresh: the redeemer MUST be the impersonated target ON the exact
  // session minted for this impersonation. The old `currentUser.id !==
  // backup.admin_user_id` check let ANY authenticated non-admin who leaked the
  // opaque `become-user` header redeem the MASTER_ADMIN session.
  //
  // CRITICAL — on binding failure we do NOT call cleanup(). cleanup(ref_id)
  // would hard-delete the LEGIT admin's backup row, letting an attacker who
  // merely leaked the header grief the real admin out of their switch-back.
  // We also don't delete the caller's session (it isn't the impersonated one).
  // We simply reject. LEGIT flow is unaffected: the genuine target replays its
  // own target session token and passes both checks below.
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

  // DD2-M5 r28: also reject expired admin sessions — without this check, a long
  // impersonation (>48h, beyond SESSION_EXPIRES_IN_SECONDS) returns the expired
  // token in the response header and the next BA call rejects with a mystery 401.
  // Fail fast (shared guard); cleanup first — switch-back tears the trap down.
  const switchBackExpiry = requireAdminSessionNotExpired(originalUserSession);
  if (!switchBackExpiry.success) {
    await cleanup(backup.ref_id);
    return switchBackExpiry;
  }

  // DECISION (nie usuwaj tego komentarza):
  // EXACTLY-ONCE redeem gate (finding impersonation-l2-6 — TOCTOU). All
  // validations above run on a READ of the backup row, so concurrent switch-backs
  // (same valid opaque token, same impersonated session) all pass them. We make
  // CONSUMPTION the gate: claimImpersonationBackupByRefId deletes the row and
  // returns true only for the single request whose delete affected 1 row. The
  // losers reject here WITHOUT restoring the session header or writing a duplicate
  // USER_SWITCHED_BACK_TO_SELF audit row. End state is identical for the winner
  // (row gone, admin session restored) — we just no longer double-count.
  const claimed = await claimImpersonationBackupByRefId(backup.ref_id);
  if (!claimed) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'backupHeader',
      message: 'Invalid or expired backup token',
    });
  }

  // Tear down the impersonated session + clear the SWITCH_BACK header. Pass NO
  // refId — the backup row was already consumed by the atomic claim above, so
  // cleanup() must not attempt a second delete. deleteSessionByToken_IO is
  // idempotent (scoped to the impersonated caller's id + token).
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

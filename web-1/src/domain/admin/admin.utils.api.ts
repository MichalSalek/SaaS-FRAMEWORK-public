import type { NextApiRequest, NextApiResponse } from 'next';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { CLEAR_THIS_HEADER_COMMAND_VALUE } from '@kernel/application/http/http.config';
import { setClientHeader } from '@app/headers/headers.utils';
import { DB_CLIENT } from '@app/db/db.client';
import { deleteSessionByToken_IO } from '@domain/user/operations/user-session.operations';
import { deleteImpersonationBackupByRefId } from './impersonation-backup.utils';

/**
 * Sanitize pagination params with safe defaults and bounds.
 * max limit = 100, max page = MAX_PAGE, min page = 1, min limit = 1.
 * page/limit are always coerced to positive integers.
 */
// DECISION: hard cap page at MAX_PAGE. skip goes straight into Prisma and Postgres scans and
// discards every skipped row, so an unbounded page would pin a pool connection on the growing log
// and audit tables. Math.trunc keeps float query values out of skip/take and the echoed DTO.
// Same cap as ai-crawler-list.operations.ts.
const MAX_PAGE = 10_000;
const MAX_LIMIT = 100;

const coercePositiveInt = (value: number | string | undefined): number => {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const sanitizePagination = (
  params: {
    page?: number | string;
    limit?: number | string;
  },
  defaultLimit = 50
): { page: number; limit: number; skip: number } => {
  const page = Math.min(
    MAX_PAGE,
    Math.max(1, coercePositiveInt(params.page) || 1)
  );
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, coercePositiveInt(params.limit) || defaultLimit)
  );
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Cleanup impersonation session.
 *
 * - Deletes the current impersonated session
 * - Removes the become-user header from the client
 * - Optionally hard-deletes the ImpersonationBackup DB row (refIdToDelete)
 *
 * DECISION: switch-back and invalid-token cleanup also delete the backup row by ref_id when
 * known; a stale row widens the replay window of a leaked opaque token. The daily cleanup
 * interceptor catches whatever falls through.
 */
export const cleanupImpersonationSession = async ({
  currentUserId,
  currentSessionToken,
  refIdToDelete,
  req,
  res,
}: {
  currentUserId: string;
  currentSessionToken: string;
  refIdToDelete?: string;
  req: NextApiRequest;
  res: NextApiResponse;
}): Promise<void> => {
  // Delete current impersonated session
  await deleteSessionByToken_IO({
    payload: {
      id: currentUserId,
      token: currentSessionToken,
    },
  });

  // Delete backup DB row (defense-in-depth; safe no-op if already gone).
  if (refIdToDelete) {
    await deleteImpersonationBackupByRefId(refIdToDelete);
  }

  // Delete backup session header
  setClientHeader({
    req,
    res,
    payload: {
      name: SWITCH_BACK_TOKEN_NAME,
      value: CLEAR_THIS_HEADER_COMMAND_VALUE,
    },
  });
};

/**
 * Explicit revoke — deletes the active impersonation backup row for an admin.
 * Idempotent (missing row is a no-op).
 *
 * DECISION: retained, uncalled, as the entry point for a future admin-UI kill switch (allowlisted
 * in audit:module-graph` (dead-exports)). Sign-out revocation is inline in handleSignOut
 * (better-auth-hooks.ts) to avoid a module cycle, and it also matches impersonated_session_token,
 * which this admin-id-only signature cannot. Admin-side eviction goes through
 * revokeImpersonationOnEviction (impersonation-eviction.ts). When wiring this, also revoke the
 * impersonated session via deleteSessionByToken_IO on impersonated_session_token.
 */
export const adminRevokeImpersonationBackup_IO = async (params: {
  adminUserId: string;
}): Promise<void> => {
  await DB_CLIENT.use.impersonationBackup
    .delete({ where: { admin_user_id: params.adminUserId } })
    .catch(() => undefined);
};

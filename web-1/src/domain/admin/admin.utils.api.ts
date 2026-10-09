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
// DECISION (nie usuwaj tego komentarza):
// Hard cap page=MAX_PAGE (10000) — chroni przed huge OFFSET DoS: skip=(page-1)*limit
// trafia wprost do Prisma findMany({skip}), a Postgres przy OFFSET skanuje+odrzuca
// wszystkie pominięte wiersze. Bez capa page=5e7 → skip~5e9 → blokada connection-pool
// na rosnącej tabeli AppLogRecord/AdminAuditTrail. Mirror jawnej decyzji z
// ai-crawler-list.operations.ts (sanitizeQuery, cap 10000). 10000 * 100 (max limit)
// = 1M rekordów — realistyczny upper bound dla obserwowalności przez kilka lat.
// Math.trunc: page/limit w DTO są integerami; float w query (?page=1.9) nie może
// wyciec do skip/take Prismy ani do echo w odpowiedzi (kontrakt DTO). Number(...)||def
// łapie NaN/0/Infinity (Math.trunc(Infinity)=Infinity → ||def-style guard niżej).
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
 * DECISION (nie usuwaj tego komentarza):
 * D23 (run 25): on switch-back / invalid-token cleanup we ALSO drop the DB
 * row by ref_id when available. Lifecycle is "issue → verify → delete";
 * leaving stale rows widens the window for a leaked opaque token to be replayed
 * even after switch-back. The 24h cleanup interceptor handles whatever falls
 * through (network errors, crashes between verify and delete).
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
 * DECISION (nie usuwaj tego komentarza):
 * RESERVE ADMIN-KEYED REVOKE (finding impersonation-l2-7). The sign-out kill-switch is
 * NOW wired — but INLINE in handleSignOut (better-auth-hooks.ts), not via this function,
 * to avoid a module cycle (better-auth.config → better-auth-hooks → impersonation ops →
 * user-session.operations → better-auth.config). The hook also matches on
 * impersonated_session_token (common case: admin operates THROUGH the impersonated
 * session, so logout signs out the TARGET, not the admin) — which this admin_user_id-only
 * signature cannot express. Admin-side forced eviction (disable / soft-delete /
 * hard-delete / logout-all) IS wired via revokeImpersonationOnEviction
 * (impersonation-eviction.ts), which tears down BOTH the orphaned impersonated
 * session AND the admin-keyed backup row — those paths do NOT orphan the backup.
 * Bulk disable/ban is covered by its own filterAdminUsers DECISION (admins excluded
 * from bulk targets). The only residual open case is TARGET-side eviction (the
 * impersonated user being evicted): it leaves a non-redeemable admin-keyed row
 * (redeem needs caller-binding to the live impersonated session) that the sweep
 * reclaims after the 12h TTL. RETAINED as the entry point for a future admin-UI kill
 * switch; when wired, key on admin id AND revoke the impersonated session via
 * deleteSessionByToken_IO on impersonated_session_token.
 * NOTE: no direct call sites today (only a comment-reference in better-auth-hooks).
 */
export const adminRevokeImpersonationBackup_IO = async (params: {
  adminUserId: string;
}): Promise<void> => {
  await DB_CLIENT.use.impersonationBackup
    .delete({ where: { admin_user_id: params.adminUserId } })
    .catch(() => undefined);
};

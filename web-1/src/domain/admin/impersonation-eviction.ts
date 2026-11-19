import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Revoke any active impersonation conducted BY this user (as admin) when their
 * access is evicted — disable (disableUser_IO), hard-delete (deleteUser_IO:
 * self + admin-delete-any), or "log out everywhere" (deleteAllSessionsOfUser_IO).
 *
 * DECISION: an evicted admin may hold an impersonated session minted for the TARGET
 * (Session.userId = target). It escapes the User-FK cascade and the account-state guard, so the
 * evicted admin kept acting as the target for the session's lifetime; the backup sweep reclaims
 * only the row. We look up the backup by admin_user_id and delete that session and the row.
 * Keyed on admin_user_id only (the sign-out hook in better-auth-hooks.ts also matches the
 * session token). Inline DB_CLIENT to avoid a module cycle with the user-domain eviction
 * primitives. Best-effort: a cleanup failure never fails the eviction.
 */
export const revokeImpersonationOnEviction = async (
  userId: string
): Promise<void> => {
  if (!userId) {
    return;
  }
  try {
    const backup = await DB_CLIENT.use.impersonationBackup.findUnique({
      where: { admin_user_id: userId },
    });
    if (!backup) {
      return;
    }
    // Tear down the orphaned impersonated (target) session first, then the backup row.
    await DB_CLIENT.use.session.deleteMany({
      where: {
        userId: backup.impersonated_user_id,
        token: backup.impersonated_session_token,
      },
    });
    await DB_CLIENT.use.impersonationBackup.deleteMany({
      where: { admin_user_id: userId },
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'IMPERSONATION_EVICTION_CLEANUP',
      message: 'Failed to revoke impersonation on eviction (swallowed)',
      payload: error,
      mode: 'error',
    });
  }
};

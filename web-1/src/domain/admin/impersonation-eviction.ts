import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Revoke any active impersonation conducted BY this user (as admin) when their
 * access is evicted — disable (disableUser_IO), hard-delete (deleteUser_IO:
 * self + admin-delete-any), or "log out everywhere" (deleteAllSessionsOfUser_IO).
 *
 * DECISION (nie usuwaj tego komentarza):
 * IMPERSONATION-EVICTION CLEANUP (connected-dots of finding impersonation-l2-7).
 * An eviction deletes the user's OWN sessions (or relies on the account-state-guard),
 * but a mid-impersonation admin ALSO holds a separate impersonated session minted for
 * the TARGET (Session.userId = target, NOT the admin). That session escapes the User-FK
 * cascade (different userId) AND the account-state-guard (which sees the un-evicted
 * target, since impersonation sessions carry no marker) — so without this a
 * disabled/deleted/force-logged-out admin keeps acting AS the target for up to the 48h
 * session lifetime (the 12h backup sweep reclaims only the backup row, never the orphaned
 * Session). We look up the backup keyed by admin_user_id = the evicted user; if present,
 * tear down the orphaned impersonated session + the backup row.
 * Keyed on admin_user_id ONLY (eviction = the admin is the one losing access — distinct
 * from the sign-out hook in better-auth-hooks.ts, which also matches
 * impersonated_session_token to cover target-session logout). Inline DB_CLIENT (NOT
 * importing admin-impersonation.operations / impersonation-backup.utils) so the
 * user-domain eviction primitives can call this without closing a module cycle.
 * Idempotent + best-effort: a cleanup failure must never fail the eviction itself.
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

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

/**
 * SESSION CONTAINER EXPIRE SWEEP
 *
 * Transitions SHARED/ACTIVE sessions past their expires_at to EXPIRED state.
 * Runs once on startup (non-blocking). Query-time filtering already hides
 * expired sessions, but explicit state transition ensures data consistency
 * for admin panels and RODO retention audits.
 */
export const expireStaleSessionContainers = async (): Promise<void> => {
  try {
    const result = await DB_CLIENT.use.sessionContainer.updateMany({
      where: {
        lifecycle_state: {
          in: [
            SessionContainerLifecycleStateValue.SHARED,
            SessionContainerLifecycleStateValue.ACTIVE,
          ],
        },
        expires_at: { lt: new Date() },
      },
      data: {
        lifecycle_state: SessionContainerLifecycleStateValue.EXPIRED,
      },
    });

    if (result.count > 0) {
      reportIssueBackend({
        namespace: 'SESSION_CONTAINER_EXPIRE_SWEEP',
        message: `Expired ${result.count} stale session containers`,
        payload: { count: result.count },
        mode: 'info',
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'SESSION_CONTAINER_EXPIRE_SWEEP',
      message: 'Failed to expire stale session containers',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
  }
};

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { extendLiveSessionExpiryQuery } from './session-container.expiry-policy';

export const expireStaleSessionContainers = async (
  options: { rethrow: boolean } = { rethrow: false }
): Promise<void> => {
  try {
    const now = new Date();
    await DB_CLIENT.use.$executeRaw(extendLiveSessionExpiryQuery(now));

    const result = await DB_CLIENT.use.sessionContainer.updateMany({
      where: {
        lifecycle_state: {
          in: [
            SessionContainerLifecycleStateValue.SHARED,
            SessionContainerLifecycleStateValue.ACTIVE,
          ],
        },
        expires_at: { lt: now },
        closed_at: null,
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
    // The scheduler job needs the failure to count it and retry; the startup warm-up does not.
    if (options.rethrow) {
      throw error;
    }
  }
};

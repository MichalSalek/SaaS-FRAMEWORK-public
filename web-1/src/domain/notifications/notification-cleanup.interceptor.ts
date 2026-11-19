// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).
// Due every 24 h under the scheduler lease; deleteMany on already deleted rows is a no-op, so a
// body that outlives a lost lease only repeats a zero. Monitoring: `sweeps` in admin /health.

/**
 * NOTIFICATION CLEANUP JOB (notifications v2, 2026-10-19)
 *
 * Two retention rules of the notification centre, both from NOTIFICATION_CONFIG:
 *  - rows older than RETENTION_DAYS (the list shows 50 newest anyway),
 *  - push devices failing for PUSH_FAILED_RETENTION_DAYS or unseen for
 *    PUSH_IDLE_RETENTION_DAYS (a device that never comes back must not keep
 *    receiving encrypted payloads nobody reads).
 */

import { TIME } from '@kernel/application/constants.config';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { cleanupOldNotifications_IO } from './operations/notification-write.operations';
import { cleanupPushSubscriptions_IO } from './operations/push-subscription.operations';

export const notificationCleanupJob = defineScheduledJob({
  name: 'notification-cleanup',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const [rows, devices] = await Promise.all([
      cleanupOldNotifications_IO(),
      cleanupPushSubscriptions_IO(),
    ]);
    const deletedRows = rows.success ? rows.data.deleted : 0;
    const deletedDevices = devices.success ? devices.data.deleted : 0;
    if (!rows.success || !devices.success) {
      throw new Error(
        `notification-cleanup: ${!rows.success ? 'rows failed' : ''} ${!devices.success ? 'devices failed' : ''}`.trim()
      );
    }
    if (deletedRows > 0 || deletedDevices > 0) {
      reportIssueBackend({
        namespace: 'notificationCleanupInterceptor',
        message: `Deleted ${deletedRows} old notifications and ${deletedDevices} stale push devices`,
        payload: { deletedRows, deletedDevices },
        mode: 'info',
      });
    }
  },
});

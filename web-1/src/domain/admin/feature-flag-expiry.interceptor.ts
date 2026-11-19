// DECISION: see web-1/src/application/scheduler/scheduled-jobs.registry.ts (what starts the periodic jobs).
// Without this sweep expires_at was shown in the admin view but never enforced.

/**
 * FEATURE FLAG EXPIRY JOB
 *
 * Due every 24h (durable lease in JobLease, one run per interval across processes). Fire-and-forget — doesn't block requests.
 * Disables feature flags whose expires_at has passed (is_enabled=true -> false) and
 * invalidates the flag cache (inside the _IO op) so the change takes effect immediately.
 *
 */

import { TIME } from '@kernel/application/constants.config';
import {
  defineScheduledJob,
  unwrapJobResult,
} from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { expireFeatureFlags_IO } from './operations/admin-feature-flags.operations';

export const featureFlagExpiryJob = defineScheduledJob({
  name: 'feature-flag-expiry',
  wakesOnTick: true,
  intervalMs: TIME.MS_PER_DAY,
  run: async () => {
    const data = unwrapJobResult(
      'feature-flag-expiry',
      await expireFeatureFlags_IO()
    );

    if (data.expired > 0) {
      reportIssueBackend({
        namespace: 'featureFlagExpiryInterceptor',
        message: `Disabled ${data.expired} expired feature flag(s)`,
        payload: { expired: data.expired },
        mode: 'info',
      });

      // DECISION: auto-expiry writes an audit row like the manual toggle, otherwise the trail shows
      // TOGGLED true with no matching off. It reuses FEATURE_FLAG_TOGGLED (a dedicated event would
      // need kernel and i18n changes); auto_expiry:true plus the system actor mark it as automatic.
      const systemActorId = await resolveSystemActorId_IO();
      void recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ADMIN.FEATURE_FLAG_TOGGLED,
        user: systemActorId ? { id: systemActorId } : null,
        requestBody: {
          expired_count: data.expired,
          auto_expiry: true,
          after_value: false,
        },
      });
    }
  },
});

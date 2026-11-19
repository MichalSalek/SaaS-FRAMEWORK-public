import type { LifecycleConfirmedAction } from '@kernel/models/email/email.dto';
import { getLifecycleActions_IO } from './emailIO.possibilities.api';
import {
  lifecycleDimensions,
  lifecycleTrackingAllowed,
  waitForLifecycleEntryValidation,
} from '../../application/analytics/email-lifecycle';
import { usePostHogReadinessStore } from '../../application/analytics/posthog-readiness.store';
import { capturePosthog } from '../../application/analytics/posthog-client';
import type { AnalyticsEventProps } from '../../application/analytics/analytics-sinks';

const emitted = new Set<string>();
const pending = new Map<string, Promise<void>>();
const checkedAt = new Map<string, number>();
const cursors = new Map<string, string>();

export function confirmedConnectionProperties(
  action: LifecycleConfirmedAction
): AnalyticsEventProps {
  const context = action.attribution;
  const elapsed = context
    ? Date.parse(action.occurredAt) - Date.parse(context.enteredAt)
    : NaN;
  if (
    !context ||
    context.accountId !== action.accountId ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed > 7 * 86400000
  ) {
    return {};
  }
  return {
    ...lifecycleDimensions(context),
    lifecycle_within_24h: elapsed <= 86400000,
    lifecycle_within_7d: true,
  };
}

/** The target stylist's browser emits only after consent/identity gates; the client actor never speaks for her. */
export function syncConfirmedLifecycleActions(force = false): Promise<void> {
  const ownerId = usePostHogReadinessStore.getState().identifiedUserId;
  if (!ownerId || !lifecycleTrackingAllowed(ownerId)) {
    return Promise.resolve();
  }
  const running = pending.get(ownerId);
  if (running) {
    return force
      ? running.then(() => syncConfirmedLifecycleActions(true))
      : running;
  }
  if (!force && Date.now() - (checkedAt.get(ownerId) ?? 0) < 5 * 60000) {
    return Promise.resolve();
  }
  const run = async () => {
    await waitForLifecycleEntryValidation();
    if (!lifecycleTrackingAllowed(ownerId)) {
      return;
    }
    let cursor = force ? undefined : cursors.get(ownerId);
    for (let page = 0; page < 10; page++) {
      const result = await getLifecycleActions_IO(cursor ? { cursor } : {});
      if (!lifecycleTrackingAllowed(ownerId)) {
        return;
      }
      for (const action of result.actions) {
        const key = `${ownerId}:${action.id}`;
        if (emitted.has(key)) {
          continue;
        }
        capturePosthog(
          'pairing_request_accepted',
          {
            flow: 'pairing',
            step: 'request_accepted',
            ...confirmedConnectionProperties(action),
          },
          { uuid: action.id, timestamp: new Date(action.occurredAt) }
        );
        emitted.add(key);
      }
      cursor = result.nextCursor ?? undefined;
      if (!cursor) {
        cursors.delete(ownerId);
        checkedAt.set(ownerId, Date.now());
        return;
      }
      cursors.set(ownerId, cursor);
    }
  };
  const promise = run()
    .catch(() => {
      /* Remains available for the stylist's next trusted interaction. */
    })
    .finally(() => pending.delete(ownerId));
  pending.set(ownerId, promise);
  return promise;
}

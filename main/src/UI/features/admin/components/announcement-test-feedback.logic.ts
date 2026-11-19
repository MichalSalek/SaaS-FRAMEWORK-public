import type { PushDispatchSummary } from '@kernel/domain/notifications/push-delivery';

export function announcementTestPushFeedback(push: PushDispatchSummary): {
  key:
    | 'testPushAccepted'
    | 'testPushPartial'
    | 'testPushNoDevices'
    | 'testPushDisabled'
    | 'testPushUnconfigured'
    | 'testPushFailed';
  state: 'complete' | 'blocked' | 'error';
} {
  if (push.sent > 0) {
    return push.failed > 0 || push.gone > 0 || push.skipped !== null
      ? { key: 'testPushPartial', state: 'blocked' }
      : { key: 'testPushAccepted', state: 'complete' };
  }
  switch (push.skipped) {
    case 'no-devices':
      return { key: 'testPushNoDevices', state: 'blocked' };
    case 'notifications-disabled':
      return { key: 'testPushDisabled', state: 'blocked' };
    case 'provider-unconfigured':
      return { key: 'testPushUnconfigured', state: 'blocked' };
    case 'lookup-failed':
    case 'dispatch-failed':
    case null:
      return { key: 'testPushFailed', state: 'error' };
  }
}

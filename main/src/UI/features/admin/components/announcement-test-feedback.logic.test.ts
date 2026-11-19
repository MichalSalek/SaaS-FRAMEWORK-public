import { describe, expect, it } from 'vitest';
import { announcementTestPushFeedback } from './announcement-test-feedback.logic';

describe('announcement test push receipt', () => {
  it('reports provider acceptance only when every attempted device succeeded', () => {
    expect(
      announcementTestPushFeedback({
        sent: 2,
        failed: 0,
        gone: 0,
        skipped: null,
      })
    ).toEqual({ key: 'testPushAccepted', state: 'complete' });
    for (const summary of [
      { sent: 1, failed: 1, gone: 0, skipped: null },
      { sent: 1, failed: 0, gone: 1, skipped: null },
      { sent: 1, failed: 0, gone: 0, skipped: 'provider-unconfigured' },
    ] as const) {
      expect(announcementTestPushFeedback(summary)).toEqual({
        key: 'testPushPartial',
        state: 'blocked',
      });
    }
  });

  it.each([
    ['no-devices', 'testPushNoDevices', 'blocked'],
    ['notifications-disabled', 'testPushDisabled', 'blocked'],
    ['provider-unconfigured', 'testPushUnconfigured', 'blocked'],
    ['lookup-failed', 'testPushFailed', 'error'],
    ['dispatch-failed', 'testPushFailed', 'error'],
    [null, 'testPushFailed', 'error'],
  ] as const)('distinguishes an unsent push (%s)', (skipped, key, state) => {
    expect(
      announcementTestPushFeedback({ sent: 0, failed: 0, gone: 0, skipped })
    ).toEqual({ key, state });
  });
});

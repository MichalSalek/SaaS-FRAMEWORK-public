import { afterEach, describe, expect, it, vi } from 'vitest';

const { emitAnalyticsEvent } = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn(),
}));
vi.mock('./analytics-sinks', () => ({ emitAnalyticsEvent }));

import { signupCompletedKey } from '../client-device-storage/storage-keys.config';
import { usePostHogReadinessStore } from './posthog-readiness.store';
import { trackSignupCompleted } from './signup-completed';

describe('signup completed analytics', () => {
  afterEach(() => {
    usePostHogReadinessStore.setState({
      isReady: false,
      identifiedUserId: null,
    });
    window.localStorage.clear();
    emitAnalyticsEvent.mockClear();
  });

  it('waits until PostHog has identified the matching user', () => {
    trackSignupCompleted('client', 'user-waiting');
    expect(emitAnalyticsEvent).not.toHaveBeenCalled();

    usePostHogReadinessStore.getState().markReady();
    usePostHogReadinessStore.getState().markIdentified('user-waiting');

    expect(emitAnalyticsEvent).toHaveBeenCalledOnce();
    expect(emitAnalyticsEvent).toHaveBeenCalledWith(
      'signup_completed',
      expect.objectContaining({ role: 'client' })
    );
  });

  it('persists the per-user latch across later calls', () => {
    usePostHogReadinessStore.getState().markReady();
    usePostHogReadinessStore.getState().markIdentified('user-once');

    trackSignupCompleted('stylist', 'user-once');
    trackSignupCompleted('stylist', 'user-once');

    expect(emitAnalyticsEvent).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(signupCompletedKey('user-once'))).toBe(
      '1'
    );
  });
});

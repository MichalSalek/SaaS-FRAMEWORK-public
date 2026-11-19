import { afterEach, describe, expect, it } from 'vitest';
import { usePostHogReadinessStore } from './posthog-readiness.store';

describe('PostHog readiness store', () => {
  afterEach(() => {
    usePostHogReadinessStore.setState({
      isReady: false,
      identifiedUserId: null,
    });
  });

  it('exposes readiness and the identified user independently', () => {
    usePostHogReadinessStore.getState().markReady();
    usePostHogReadinessStore.getState().markIdentified('user-1');

    expect(usePostHogReadinessStore.getState().isReady).toBe(true);
    expect(usePostHogReadinessStore.getState().identifiedUserId).toBe('user-1');

    usePostHogReadinessStore.getState().clearIdentified();
    expect(usePostHogReadinessStore.getState().identifiedUserId).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

const { emitAnalyticsEvent, clarity } = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn(),
  clarity: vi.fn(),
}));
vi.mock('./analytics-sinks', () => ({ emitAnalyticsEvent, clarity }));

import { resetDemoInteractionGuard, trackDemoInteraction } from './demo-events';

describe('demo interaction analytics', () => {
  afterEach(() => {
    resetDemoInteractionGuard();
    emitAnalyticsEvent.mockClear();
    clarity.mockClear();
  });

  it('captures each demo action tuple once until the page view resets', () => {
    trackDemoInteraction('reviews', 'expand');
    trackDemoInteraction('reviews', 'expand');
    expect(emitAnalyticsEvent).toHaveBeenCalledOnce();
    expect(clarity).toHaveBeenCalledWith('set', 'demo_used', 'reviews');

    resetDemoInteractionGuard();
    trackDemoInteraction('reviews', 'expand');
    expect(emitAnalyticsEvent).toHaveBeenCalledTimes(2);
  });
});

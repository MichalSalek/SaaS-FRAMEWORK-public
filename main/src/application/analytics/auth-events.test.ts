import { afterEach, describe, expect, it, vi } from 'vitest';

const { emitAnalyticsEvent, clarity } = vi.hoisted(() => ({
  emitAnalyticsEvent: vi.fn(),
  clarity: vi.fn(),
}));
vi.mock('./analytics-sinks', () => ({ emitAnalyticsEvent, clarity }));

import { trackAuthStarted } from './auth-events';

describe('auth_started analytics', () => {
  afterEach(() => {
    window.localStorage.clear();
    emitAnalyticsEvent.mockClear();
    clarity.mockClear();
  });

  it('sends the selected method and intent to both configured sinks', () => {
    trackAuthStarted('magic_link', 'register');

    expect(emitAnalyticsEvent).toHaveBeenCalledWith('auth_started', {
      method: 'magic_link',
      intent: 'register',
      first_cta: undefined,
    });
    expect(clarity).toHaveBeenCalledWith('set', 'auth_started', 'magic_link');
  });
});

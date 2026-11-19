import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../application/platform/platform.detection', () => ({
  detectPlatform: () => ({ isNativeApp: true }),
}));
vi.mock('./native-push', () => ({
  isNativePushAvailable: async () => true,
  getNativePushPermission: async () => 'granted',
}));
vi.mock('./native-push-lifecycle', () => ({
  getNativePushRegistrationState: async () => ({
    subscribed: false,
    removalPending: true,
  }),
}));
import { usePushOptIn } from './push.controller';

describe('native push removal recovery', () => {
  it('surfaces unresolved removal after reload without reporting a subscription', async () => {
    const view = renderHook(() => usePushOptIn());
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    expect(view.result.current.status).toBe('off');
    expect(view.result.current.failed).toBe(true);
  });
});

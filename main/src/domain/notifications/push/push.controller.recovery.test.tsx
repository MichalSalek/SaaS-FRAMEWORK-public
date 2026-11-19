import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../application/platform/platform.detection', () => ({
  detectPlatform: () => ({ isNativeApp: false }),
}));
vi.mock('./web-push', () => ({
  isWebPushSupported: () => true,
  getWebPushPermission: () => 'prompt',
  getWebPushSubscription: async () => null,
  subscribeWebPush: async () => {
    throw new Error('permission API failed');
  },
}));
import { usePushOptIn } from './push.controller';

describe('push permission recovery', () => {
  it('releases the switch and reports a rejected permission request', async () => {
    const view = renderHook(() => usePushOptIn());
    await waitFor(() => expect(view.result.current.busy).toBe(false));
    await act(async () => {
      await view.result.current.enable();
    });
    expect(view.result.current.busy).toBe(false);
    expect(view.result.current.failed).toBe(true);
  });
});

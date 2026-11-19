import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ forget: vi.fn() }));
vi.mock('../../../application/platform/platform.detection', () => ({
  detectPlatform: () => ({ isNativeApp: true }),
}));
vi.mock('./native-push-lifecycle', () => ({
  forgetNativePushDevice: mock.forget,
}));
vi.mock('./web-push', () => ({ unsubscribeWebPush: vi.fn() }));
import { signOutAndForgetPushDevice } from './sign-out-with-push';

describe('native sign-out', () => {
  it('revokes the session even if removing the device fails', async () => {
    mock.forget.mockRejectedValueOnce(new Error('offline'));
    const signOut = vi.fn(async () => undefined);
    await signOutAndForgetPushDevice(signOut);
    expect(signOut).toHaveBeenCalledOnce();
  });
});

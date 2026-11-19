import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

const mock = vi.hoisted(() => {
  const listeners = new Map<string, (value: never) => void>();
  return {
    listeners,
    session: vi.fn(),
    registerBackend: vi.fn(),
    unregisterBackend: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    permission: vi.fn(),
    addListener: vi.fn(
      async (event: string, listener: (value: never) => void) => {
        listeners.set(event, listener);
        return {
          remove: async () => {
            if (listeners.get(event) === listener) {
              listeners.delete(event);
            }
          },
        };
      }
    ),
  };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => ({
    checkPermissions: mock.permission,
    requestPermissions: mock.permission,
    register: mock.register,
    unregister: mock.unregister,
    addListener: mock.addListener,
  }),
}));
vi.mock('../../../application/auth/better-auth-client', () => ({
  authClient: { getSession: mock.session },
}));
vi.mock('../notificationsIO.possibilities.api', () => ({
  registerPushSubscription_IO: mock.registerBackend,
  unregisterPushSubscription_IO: mock.unregisterBackend,
}));
import { readNativePushState, writeNativePushState } from './native-push-state';
import {
  forgetNativePushDevice,
  getNativePushRegistrationState,
  subscribeNativePush,
  syncNativePush,
  unsubscribeNativePush,
} from './native-push-lifecycle';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(CUSTOM_HEADERS.authorization, 'bearer-a');
  mock.listeners.clear();
  mock.session
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  mock.permission.mockReset().mockResolvedValue({ receive: 'granted' });
  mock.register.mockReset().mockImplementation(async () => {
    queueMicrotask(() =>
      mock.listeners.get('registration')?.({ value: 'device-token' } as never)
    );
  });
  mock.unregister.mockReset().mockResolvedValue(undefined);
  mock.registerBackend
    .mockReset()
    .mockResolvedValue({ subscription_id: 'saved' });
  mock.unregisterBackend.mockReset().mockResolvedValue({ removed: true });
});

describe('native push device lifecycle', () => {
  it('waits for the native token and backend acknowledgement before reporting subscribed', async () => {
    let ack!: (value: { subscription_id: string }) => void;
    mock.registerBackend.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          ack = resolve;
        })
    );
    let settled = false;
    const pending = subscribeNativePush().then(value => {
      settled = true;
      return value;
    });
    await waitFor(() => expect(mock.registerBackend).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    let readSettled = false;
    const read = getNativePushRegistrationState().then(value => {
      readSettled = true;
      return value;
    });
    await Promise.resolve();
    expect(readSettled).toBe(false);
    ack({ subscription_id: 'saved' });
    await expect(pending).resolves.toBe('subscribed');
    expect((await read).subscribed).toBe(true);
    expect((await getNativePushRegistrationState()).subscribed).toBe(true);
  });

  it('preserves opt-out and does not automatically register again after disable', async () => {
    await expect(subscribeNativePush()).resolves.toBe('subscribed');
    await expect(unsubscribeNativePush()).resolves.toBe(true);
    expect(mock.unregisterBackend).toHaveBeenCalledWith(
      { endpoint: 'device-token' },
      { silentBusinessError: true }
    );
    expect(readNativePushState('user-a')).toEqual({
      optedOut: true,
      endpoint: null,
      registered: false,
    });
    mock.register.mockClear();
    await syncNativePush();
    expect(mock.register).not.toHaveBeenCalled();
  });

  it('does not write a token for a different bearer after the registration event is delayed', async () => {
    mock.register.mockImplementationOnce(async () => undefined);
    const pending = subscribeNativePush();
    await waitFor(() => expect(mock.register).toHaveBeenCalledOnce());
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'bearer-b');
    mock.listeners.get('registration')?.({ value: 'old-token' } as never);
    await expect(pending).resolves.toBe('failed');
    expect(mock.registerBackend).not.toHaveBeenCalled();
  });

  it('does not report success when opt-out races an in-flight registration', async () => {
    let ack!: (value: { subscription_id: string }) => void;
    mock.registerBackend.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          ack = resolve;
        })
    );
    const pending = subscribeNativePush();
    await waitFor(() => expect(mock.registerBackend).toHaveBeenCalledOnce());
    const disabling = unsubscribeNativePush();
    await waitFor(() =>
      expect(readNativePushState('user-a').optedOut).toBe(true)
    );
    ack({ subscription_id: 'saved' });
    await expect(pending).resolves.toBe('failed');
    await expect(disabling).resolves.toBe(true);
    expect((await getNativePushRegistrationState()).subscribed).toBe(false);
    expect(mock.unregisterBackend).toHaveBeenCalledOnce();
  });

  it('does not acknowledge an old registration after the account token changes', async () => {
    let ack!: (value: { subscription_id: string }) => void;
    mock.registerBackend.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          ack = resolve;
        })
    );
    const pending = subscribeNativePush();
    await waitFor(() => expect(mock.registerBackend).toHaveBeenCalledOnce());
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'bearer-b');
    ack({ subscription_id: 'saved' });
    await expect(pending).resolves.toBe('failed');
    expect(readNativePushState('user-a').registered).toBe(false);
  });

  it('treats a native registration error as failure without a backend write', async () => {
    mock.register.mockImplementationOnce(async () => {
      queueMicrotask(() =>
        mock.listeners.get('registrationError')?.({
          error: 'no provider',
        } as never)
      );
    });
    await expect(subscribeNativePush()).resolves.toBe('failed');
    expect(mock.registerBackend).not.toHaveBeenCalled();
    expect((await getNativePushRegistrationState()).subscribed).toBe(false);
  });

  it('ignores a retained token delivered while the listener is attached', async () => {
    mock.addListener.mockImplementationOnce(async (event, listener) => {
      mock.listeners.set(event, listener);
      listener({ value: 'old-retained-token' } as never);
      return {
        remove: async () => {
          mock.listeners.delete(event);
        },
      };
    });
    await expect(subscribeNativePush()).resolves.toBe('subscribed');
    expect(mock.registerBackend).toHaveBeenCalledWith(
      { platform: 'FCM', endpoint: 'device-token' },
      { silentBusinessError: true }
    );
  });

  it('retains the opt-out and retries backend removal after a failed disable', async () => {
    await subscribeNativePush();
    mock.unregisterBackend.mockRejectedValueOnce(new Error('offline'));
    await expect(unsubscribeNativePush()).resolves.toBe(false);
    expect(readNativePushState('user-a').optedOut).toBe(true);
    expect((await getNativePushRegistrationState()).subscribed).toBe(false);
    expect(await getNativePushRegistrationState()).toEqual({
      subscribed: false,
      removalPending: true,
    });
    mock.register.mockClear();
    await syncNativePush();
    expect(mock.register).not.toHaveBeenCalled();
    expect(readNativePushState('user-a')).toEqual({
      optedOut: true,
      endpoint: null,
      registered: false,
    });
  });

  it('keeps a discovered token when the first removal fails so sync can retry', async () => {
    mock.unregisterBackend.mockRejectedValueOnce(new Error('offline'));
    await expect(unsubscribeNativePush()).resolves.toBe(false);
    expect(readNativePushState('user-a')).toEqual({
      optedOut: true,
      endpoint: 'device-token',
      registered: false,
    });
    mock.register.mockClear();
    await syncNativePush();
    expect(mock.register).not.toHaveBeenCalled();
    expect(mock.unregisterBackend).toHaveBeenCalledTimes(2);
    expect(readNativePushState('user-a').endpoint).toBeNull();
  });

  it('removes the previous registered endpoint when the native token rotates', async () => {
    writeNativePushState('user-a', {
      optedOut: false,
      endpoint: 'old-token',
      registered: true,
    });
    await expect(subscribeNativePush()).resolves.toBe('subscribed');
    expect(mock.unregisterBackend).toHaveBeenCalledWith(
      { endpoint: 'old-token' },
      { silentBusinessError: true }
    );
    expect(readNativePushState('user-a').endpoint).toBe('device-token');
  });

  it('does not retain a confirmation for another user after endpoint reassignment', async () => {
    writeNativePushState('user-b', {
      optedOut: false,
      endpoint: 'device-token',
      registered: true,
    });
    await expect(subscribeNativePush()).resolves.toBe('subscribed');
    expect(readNativePushState('user-b').registered).toBe(false);
    expect(readNativePushState('user-a').registered).toBe(true);
  });

  it('honours the later opt-out if enable was waiting for identity', async () => {
    let session!: (value: unknown) => void;
    mock.session.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          session = resolve;
        })
    );
    writeNativePushState('user-a', {
      optedOut: false,
      endpoint: 'device-token',
      registered: true,
    });
    const enable = subscribeNativePush();
    await expect(unsubscribeNativePush()).resolves.toBe(true);
    session({ data: { user: { id: 'user-a' } }, error: null });
    await expect(enable).resolves.toBe('failed');
    expect(mock.registerBackend).not.toHaveBeenCalled();
    expect(readNativePushState('user-a').optedOut).toBe(true);
  });

  it('unregisters the current device before logout without changing its preference', async () => {
    await subscribeNativePush();
    await forgetNativePushDevice();
    expect(mock.unregisterBackend).toHaveBeenCalledOnce();
    expect(readNativePushState('user-a')).toEqual({
      optedOut: false,
      endpoint: null,
      registered: false,
    });
  });
});

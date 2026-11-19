import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';

const mock = vi.hoisted(() => {
  const listeners = new Map<string, (value: never) => void>();
  return {
    listeners,
    session: vi.fn(),
    registerBackend: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(),
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../../application/platform/platform.detection', () => ({
  detectPlatform: () => ({ isNativeApp: true }),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => ({
    checkPermissions: mock.checkPermissions,
    requestPermissions: mock.requestPermissions,
    register: mock.register,
    addListener: async (event: string, listener: (value: never) => void) => {
      mock.listeners.set(event, listener);
      return {
        remove: async () => {
          mock.listeners.delete(event);
        },
      };
    },
  }),
}));
vi.mock('../../../../application/auth/better-auth-client', () => ({
  authClient: { getSession: mock.session },
}));
vi.mock(
  '../../../../domain/notifications/notificationsIO.possibilities.api',
  () => ({
    registerPushSubscription_IO: mock.registerBackend,
    unregisterPushSubscription_IO: vi.fn(),
  })
);

import {
  NATIVE_PUSH_STATE_EVENT,
  writeNativePushState,
} from '../../../../domain/notifications/push/native-push-state';
import { syncNativePush } from '../../../../domain/notifications/push/native-push-lifecycle';
import { PushOptInOrganism } from './PushOptIn.organism';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(CUSTOM_HEADERS.authorization, 'bearer-a');
  mock.listeners.clear();
  mock.session
    .mockReset()
    .mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  mock.checkPermissions.mockReset().mockResolvedValue({ receive: 'granted' });
  mock.requestPermissions.mockReset();
  mock.register.mockReset().mockImplementation(async () => {
    queueMicrotask(() =>
      mock.listeners.get('registration')?.({ value: 'device-token' } as never)
    );
  });
  mock.registerBackend
    .mockReset()
    .mockResolvedValue({ subscription_id: 'saved' });
});

describe('notification centre push control', () => {
  it('does not flash off while an already registered device is being synchronized', async () => {
    writeNativePushState('user-a', {
      optedOut: false,
      endpoint: 'device-token',
      registered: true,
    });
    let acknowledge!: (value: { subscription_id: string }) => void;
    mock.registerBackend.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          acknowledge = resolve;
        })
    );
    const sync = syncNativePush();
    await waitFor(() => expect(mock.registerBackend).toHaveBeenCalledOnce());
    render(<PushOptInOrganism onlyWhenOff />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('switch')).toBeNull();
    await act(async () => {
      acknowledge({ subscription_id: 'saved' });
      await sync;
    });
    await waitFor(() => expect(screen.queryByRole('switch')).toBeNull());
    expect(mock.requestPermissions).not.toHaveBeenCalled();
  });

  it('shows the control when absence is confirmed', async () => {
    render(<PushOptInOrganism onlyWhenOff />);
    const control = await screen.findByRole('switch');
    expect(control).not.toBeChecked();
    expect(mock.requestPermissions).not.toHaveBeenCalled();
  });

  it('shows denied only for an explicit system refusal', async () => {
    mock.checkPermissions.mockResolvedValue({ receive: 'denied' });
    render(<PushOptInOrganism onlyWhenOff />);
    expect(await screen.findByText('captionDenied')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(mock.requestPermissions).not.toHaveBeenCalled();
  });

  it('shows a read error in settings without presenting an unconfirmed off switch', async () => {
    mock.checkPermissions.mockRejectedValue(new Error('bridge unavailable'));
    const view = render(<PushOptInOrganism onlyWhenOff />);
    await waitFor(() => expect(mock.checkPermissions).toHaveBeenCalled());
    expect(screen.queryByRole('switch')).toBeNull();
    view.unmount();
    render(<PushOptInOrganism />);
    expect(await screen.findByRole('alert')).toHaveTextContent('readFailed');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText('captionDenied')).toBeNull();
    expect(mock.requestPermissions).not.toHaveBeenCalled();
  });

  it('reports a later read error independently of the previously confirmed status', async () => {
    render(<PushOptInOrganism />);
    expect(await screen.findByRole('switch')).not.toBeChecked();
    mock.checkPermissions.mockRejectedValue(new Error('bridge unavailable'));
    act(() => {
      window.dispatchEvent(new Event(NATIVE_PUSH_STATE_EVENT));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('readFailed');
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('shows off after a backend registration failure instead of claiming success', async () => {
    writeNativePushState('user-a', {
      optedOut: false,
      endpoint: 'device-token',
      registered: true,
    });
    let reject!: (error: Error) => void;
    mock.registerBackend.mockImplementationOnce(
      () =>
        new Promise((_, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    const sync = syncNativePush();
    await waitFor(() => expect(mock.registerBackend).toHaveBeenCalledOnce());
    render(<PushOptInOrganism onlyWhenOff />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('switch')).toBeNull();
    await act(async () => {
      reject(new Error('offline'));
      await sync;
    });
    expect(await screen.findByRole('switch')).not.toBeChecked();
  });
});

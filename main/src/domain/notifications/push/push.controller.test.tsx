import { act, renderHook } from '@testing-library/react';
import type * as ReactQuery from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  push: vi.fn(async () => true),
  invalidateQueries: vi.fn(async () => undefined),
}));

vi.mock('next/router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));
vi.mock('../../../application/platform/platform.detection', () => ({
  detectPlatform: () => ({ isNativeApp: false }),
}));
vi.mock('./web-push', () => ({
  isWebPushSupported: () => true,
  syncWebPushSubscription: vi.fn(async () => undefined),
}));

import { usePushController } from './push.controller';

describe('push controller on a localized app page', () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(
    navigator,
    'serviceWorker'
  );
  afterEach(() => {
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    } else {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    }
    window.history.replaceState({}, '', '/');
    vi.clearAllMocks();
  });

  it('registers on /de/app, acknowledges readiness and routes a query-bearing request', () => {
    window.history.replaceState({}, '', '/de/app/account');
    let listener: ((event: MessageEvent<unknown>) => void) | undefined;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (
          _type: string,
          fn: (event: MessageEvent<unknown>) => void
        ) => {
          listener = fn;
        },
        removeEventListener: vi.fn(),
      },
    });
    const { unmount } = renderHook(() => usePushController(true));
    const ack = vi.fn();
    const probe = {
      data: { type: 'nf-push-probe' },
      ports: [{ postMessage: ack }],
    } as unknown as MessageEvent<unknown>;
    expect(listener).toBeDefined();
    act(() => listener?.(probe));
    expect(ack).toHaveBeenCalledWith({ type: 'nf-push-ready' });
    expect(mocks.push).not.toHaveBeenCalled();
    const request = {
      data: {
        type: 'nf-push-open',
        url: `${window.location.origin}/de/app/notifications/open?id=ntf_1#item`,
      },
      ports: [],
    } as unknown as MessageEvent<unknown>;
    act(() => listener?.(request));
    expect(mocks.push).toHaveBeenCalledWith(
      '/app/notifications/open?id=ntf_1#item',
      undefined,
      { locale: 'de' }
    );
    expect(ack.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0] ?? Infinity
    );
    unmount();
  });
});

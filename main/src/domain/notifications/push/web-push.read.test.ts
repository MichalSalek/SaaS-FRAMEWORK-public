import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../application/environment/environment.config', () => ({
  ENV_VARS: { NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY: 'test-key' },
}));
vi.mock(
  '../../../application/error-debugger/errorHandler.possibilities.api',
  () => ({
    reportIssueFrontend: vi.fn(),
  })
);
import { getWebPushSubscription } from './web-push';

const originals = {
  serviceWorker: Object.getOwnPropertyDescriptor(navigator, 'serviceWorker'),
  pushManager: Object.getOwnPropertyDescriptor(window, 'PushManager'),
  notification: Object.getOwnPropertyDescriptor(window, 'Notification'),
};

afterEach(() => {
  for (const [object, key, descriptor] of [
    [navigator, 'serviceWorker', originals.serviceWorker],
    [window, 'PushManager', originals.pushManager],
    [window, 'Notification', originals.notification],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(object, key, descriptor);
    } else {
      Reflect.deleteProperty(object, key);
    }
  }
});

function mockWebPush(getSubscription: () => Promise<unknown>) {
  const registration = { pushManager: { getSubscription } };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => registration,
      ready: Promise.resolve(registration),
    },
  });
  Object.defineProperty(window, 'PushManager', {
    configurable: true,
    value: class {},
  });
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: class {},
  });
}

describe('web push opt-in state read', () => {
  it('distinguishes a subscription read failure from a confirmed absence', async () => {
    mockWebPush(async () => {
      throw new Error('push manager unavailable');
    });
    await expect(getWebPushSubscription(true)).rejects.toThrow(
      'push manager unavailable'
    );
    await expect(getWebPushSubscription()).resolves.toBeNull();
    mockWebPush(async () => null);
    await expect(getWebPushSubscription(true)).resolves.toBeNull();
  });
});

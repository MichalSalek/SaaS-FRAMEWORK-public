import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ subscription: vi.fn(), subscribe: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../../application/platform/platform.detection', () => ({
  detectPlatform: () => ({ isNativeApp: false }),
}));
vi.mock('../../../../domain/notifications/push/web-push', () => ({
  isWebPushSupported: () => true,
  getWebPushPermission: () => 'granted',
  getWebPushSubscription: mock.subscription,
  subscribeWebPush: mock.subscribe,
}));
import { PushOptInOrganism } from './PushOptIn.organism';

beforeEach(() => {
  mock.subscription.mockReset();
  mock.subscribe.mockReset();
});

describe('web push control', () => {
  it('waits for the subscription read before showing an off switch', async () => {
    let resolve!: (value: object) => void;
    mock.subscription.mockReturnValue(
      new Promise(res => {
        resolve = res;
      })
    );
    render(<PushOptInOrganism onlyWhenOff />);
    expect(screen.queryByRole('switch')).toBeNull();
    await act(async () => {
      resolve({});
    });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(mock.subscription).toHaveBeenCalledWith(true);
    expect(mock.subscribe).not.toHaveBeenCalled();
  });

  it('shows a failed read in settings without claiming it is off', async () => {
    mock.subscription.mockRejectedValue(new Error('read failed'));
    render(<PushOptInOrganism />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(mock.subscribe).not.toHaveBeenCalled();
  });
});

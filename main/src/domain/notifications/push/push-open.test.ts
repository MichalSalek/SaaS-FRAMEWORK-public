import { describe, expect, it, vi } from 'vitest';
import { handlePushOpenMessage, resolvePushRoute } from './push-open';
import {
  getLeavePrompt,
  registerLeaveGuard,
  requestLeave,
  resetLeaveGuardForTests,
} from '../../../application/routing/leave-guard';

const origin = 'https://nailfolio.example';

describe('resolvePushRoute', () => {
  it('preserves search and hash from a same-origin URL', () => {
    expect(
      resolvePushRoute(`${origin}/app/notifications/open?id=ntf_1#item`, origin)
    ).toEqual({
      path: '/app/notifications/open?id=ntf_1#item',
      locale: undefined,
    });
  });

  it('handles an explicit locale without double-prefixing the Next router path', () => {
    expect(
      resolvePushRoute('/de/app/notifications/open?id=ntf_1', origin)
    ).toEqual({
      path: '/app/notifications/open?id=ntf_1',
      locale: 'de',
    });
  });

  it('accepts an app URL on the same native custom-scheme host', () => {
    expect(
      resolvePushRoute(
        'capacitor://localhost/app/notifications/open?id=ntf_1',
        'capacitor://localhost'
      )
    ).toEqual({
      path: '/app/notifications/open?id=ntf_1',
      locale: undefined,
    });
    expect(
      resolvePushRoute(
        'capacitor://evil/app/notifications',
        'capacitor://localhost'
      )
    ).toEqual({
      path: '/app/notifications',
      locale: undefined,
    });
  });

  it.each([
    'https://evil.example/app/notifications',
    '//evil.example/app/notifications',
    '/apple',
    '/en/pricing',
    'javascript:alert(1)',
    '/app/../../pricing',
    '/\\evil.example/app',
  ])('falls back safely for %s', value => {
    expect(resolvePushRoute(value, origin)).toEqual({
      path: '/app/notifications',
      locale: undefined,
    });
  });
});

describe('handlePushOpenMessage', () => {
  it('confirms readiness without navigating, then routes an open request', () => {
    const order: string[] = [];
    const navigate = vi.fn(() => order.push('navigate'));
    const acknowledge = vi.fn(() => order.push('ack'));
    expect(
      handlePushOpenMessage(
        { type: 'nf-push-probe' },
        origin,
        navigate,
        acknowledge
      )
    ).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(
      handlePushOpenMessage(
        {
          type: 'nf-push-open',
          url: `${origin}/app/notifications/open?id=ntf_1`,
        },
        origin,
        navigate,
        acknowledge
      )
    ).toBe(true);
    expect(navigate).toHaveBeenCalledWith(
      '/app/notifications/open?id=ntf_1',
      undefined
    );
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(order).toEqual(['ack', 'navigate']);
  });

  it('ignores unrelated messages and does not acknowledge them', () => {
    const navigate = vi.fn();
    const acknowledge = vi.fn();
    expect(
      handlePushOpenMessage(
        { type: 'nf-push-received' },
        origin,
        navigate,
        acknowledge
      )
    ).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('acknowledges a guarded navigation before the person decides to stay', () => {
    window.history.replaceState({}, '', '/app/profile');
    const release = registerLeaveGuard('Unsaved work');
    const proceed = vi.fn();
    const acknowledge = vi.fn();
    try {
      const navigate = (path: string) => {
        if (requestLeave(path, proceed)) {
          proceed();
        }
      };
      handlePushOpenMessage(
        { type: 'nf-push-probe' },
        origin,
        navigate,
        acknowledge
      );
      expect(acknowledge).toHaveBeenCalledOnce();
      expect(getLeavePrompt()).toBeNull();
      handlePushOpenMessage(
        { type: 'nf-push-open', url: '/app/notifications/open?id=ntf_1' },
        origin,
        navigate,
        acknowledge
      );
      expect(getLeavePrompt()).not.toBeNull();
      getLeavePrompt()?.cancel();
      expect(proceed).not.toHaveBeenCalled();
    } finally {
      release();
      resetLeaveGuardForTests();
      window.history.replaceState({}, '', '/');
    }
  });

  it('does not navigate on a late readiness probe', () => {
    const navigate = vi.fn();
    const acknowledge = vi.fn();
    expect(
      handlePushOpenMessage(
        { type: 'nf-push-probe' },
        origin,
        navigate,
        acknowledge
      )
    ).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(acknowledge).toHaveBeenCalledOnce();
  });
});

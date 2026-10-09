import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

const routerMock = vi.hoisted(() => ({
  pathname: '/app',
  locale: 'en' as string | undefined,
  replace: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => routerMock,
}));

vi.mock('../../contexts/AuthContext.composition', () => ({
  useHasLiveAccountSession: (): boolean => true,
}));

vi.mock('../../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({ isPending: false }),
  },
}));

vi.mock('../../../application/routing/navigation.possibilities.api', () => ({
  runInstant: (_reason: string, performNav: () => unknown): unknown =>
    performNav(),
}));

import {
  resolveDesktopBounceDecision,
  useDesktopRedirectGuard,
} from './useDesktopRedirectGuard';

// Pure target-selection for the desktop product-route bounce (the hook itself
// only wires the side-effect). Owner decision 2026-07-10: a LOGGED-IN plain
// desktop user landing on bare /app goes to the account shell, not /get-app.
// Doprecyzowanie 2026-09-09: celem jest APP_HOME (web-home z banerem
// „weź to na telefon"), nie formularz ustawień USER_ACCOUNT.
//
// ROUTES_FRONT values used in assertions (matching routing.config.ts):
//   ROUTES_FRONT.APP          = '/app'
//   ROUTES_FRONT.APP_HOME     = '/app/home'
//   ROUTES_FRONT.USER_ACCOUNT = '/app/user/account'
//   ROUTES_FRONT.GET_APP      = '/get-app'

const settled = { isSessionPending: false };

describe('resolveDesktopBounceDecision', () => {
  // ── excluded routes (never bounced) ──

  it('never bounces /get-app itself', () => {
    expect(
      resolveDesktopBounceDecision({
        pathname: ROUTES_FRONT.GET_APP,
        hasLiveSession: false,
        ...settled,
      })
    ).toEqual({ kind: 'none' });
  });

  it('never bounces account routes (web-login-first)', () => {
    for (const pathname of [
      '/user/login',
      '/app/onboarding',
      '/app/home',
      '/app/profile',
      '/app/user/account',
      '/app/user/account/pay',
      '/app/checkout/return',
      '/app/salon/invitations',
    ]) {
      expect(
        resolveDesktopBounceDecision({
          pathname,
          hasLiveSession: true,
          ...settled,
        })
      ).toEqual({ kind: 'none' });
    }
  });

  it('never bounces static (LP) routes', () => {
    expect(
      resolveDesktopBounceDecision({
        pathname: '/pricing',
        hasLiveSession: false,
        ...settled,
      })
    ).toEqual({ kind: 'none' });
  });

  // ── bare /app index (owner 2026-07-10) ──

  it('sends a logged-in user on bare /app to the web-home', () => {
    expect(
      resolveDesktopBounceDecision({
        pathname: ROUTES_FRONT.APP,
        hasLiveSession: true,
        ...settled,
      })
    ).toEqual({ kind: 'redirect', target: ROUTES_FRONT.APP_HOME });
  });

  it('sends a visitor (no live session) on bare /app to /get-app (unchanged)', () => {
    expect(
      resolveDesktopBounceDecision({
        pathname: ROUTES_FRONT.APP,
        hasLiveSession: false,
        ...settled,
      })
    ).toEqual({ kind: 'redirect', target: ROUTES_FRONT.GET_APP });
  });

  it('holds on bare /app while a token-holder session is still pending', () => {
    // Optimistic hasLiveSession=true + pending → do not guess; replace is
    // irreversible, the empty shell renders meanwhile.
    expect(
      resolveDesktopBounceDecision({
        pathname: ROUTES_FRONT.APP,
        hasLiveSession: true,
        isSessionPending: true,
      })
    ).toEqual({ kind: 'hold' });
  });

  it('does NOT hold for a visitor without a token, even while pending', () => {
    // No token → hasLiveSession=false from the start → immediate /get-app.
    expect(
      resolveDesktopBounceDecision({
        pathname: ROUTES_FRONT.APP,
        hasLiveSession: false,
        isSessionPending: true,
      })
    ).toEqual({ kind: 'redirect', target: ROUTES_FRONT.GET_APP });
  });

  it('bounces bare /app to /get-app for a settled-invalid (stale) token', () => {
    // useHasLiveAccountSession collapses to false once the session settles
    // null — same destination as today for an effectively logged-out visitor.
    expect(
      resolveDesktopBounceDecision({
        pathname: ROUTES_FRONT.APP,
        hasLiveSession: false,
        isSessionPending: false,
      })
    ).toEqual({ kind: 'redirect', target: ROUTES_FRONT.GET_APP });
  });

  // ── other product routes (mobile-only zone stays bounced) ──

  it('bounces deeper product routes to /get-app even for a logged-in user', () => {
    for (const pathname of ['/app/gallery', '/app/stylists', '/app/explore']) {
      expect(
        resolveDesktopBounceDecision({
          pathname,
          hasLiveSession: true,
          ...settled,
        })
      ).toEqual({ kind: 'redirect', target: ROUTES_FRONT.GET_APP });
    }
  });

  it('bounces product routes to /get-app for visitors (unchanged)', () => {
    expect(
      resolveDesktopBounceDecision({
        pathname: '/app/gallery',
        hasLiveSession: false,
        ...settled,
      })
    ).toEqual({ kind: 'redirect', target: ROUTES_FRONT.GET_APP });
  });
});

describe('useDesktopRedirectGuard — D6 locale on bounce', () => {
  beforeEach(() => {
    routerMock.pathname = '/app';
    routerMock.locale = 'en';
    routerMock.replace.mockClear();
  });

  it('passes { locale: en } to replace when bouncing a logged-in /app', () => {
    routerMock.locale = 'en';
    renderHook(() => useDesktopRedirectGuard({ desktopAccess: 'redirect' }));
    expect(routerMock.replace).toHaveBeenCalledWith('/app/home', undefined, {
      locale: 'en',
    });
  });

  it('omits the locale option when router.locale is undefined', () => {
    routerMock.locale = undefined;
    renderHook(() => useDesktopRedirectGuard({ desktopAccess: 'redirect' }));
    expect(routerMock.replace).toHaveBeenCalledWith(
      '/app/home',
      undefined,
      undefined
    );
  });
});

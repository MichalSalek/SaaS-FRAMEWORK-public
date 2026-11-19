import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { resolveBackFallback } from './appBackTargets.config';

describe('resolveBackFallback', () => {
  it.each([
    ['/app/user/account/[section]', ROUTES_FRONT.USER_ACCOUNT],
    ['/app/user/account/pay', ROUTES_FRONT.USER_ACCOUNT],
    ['/app/user/support/[threadId]', ROUTES_FRONT.SUPPORT_THREADS],
    ['/app/user/support/new', ROUTES_FRONT.SUPPORT],
    ['/app/user/support/threads', ROUTES_FRONT.SUPPORT],
    ['/app/user/delete-self', ROUTES_FRONT.USER_ACCOUNT],
    ['/app/messages/[pairId]', ROUTES_FRONT.MESSAGES],
    ['/app/sessions/[sessionId]', ROUTES_FRONT.CLIENT_SESSIONS],
    ['/app/inbox/session/[sessionId]', ROUTES_FRONT.SHARED],
    ['/app/clients/[id]', ROUTES_FRONT.CLIENTS],
    ['/app/photo/[id]', ROUTES_FRONT.GALLERY],
    ['/app/gallery/stylist/[id]', ROUTES_FRONT.GALLERY],
  ])('%s goes up to %s', (pathname, parent) => {
    expect(resolveBackFallback(pathname)).toBe(parent);
  });

  it('falls back to the app home for a route with no listed parent', () => {
    expect(resolveBackFallback('/app/salon/staff')).toBe(ROUTES_FRONT.APP);
    expect(resolveBackFallback('/app/user/account')).toBe(ROUTES_FRONT.APP);
  });

  it('sends the client list to the app home, not to the client card rule', () => {
    expect(resolveBackFallback(ROUTES_FRONT.CLIENTS)).toBe(ROUTES_FRONT.APP);
    expect(resolveBackFallback(ROUTES_FRONT.PAIRING)).toBe(ROUTES_FRONT.APP);
  });

  it('never sends a sub-page to itself', () => {
    const subPages = Object.values(ROUTES_FRONT).filter(route =>
      route.startsWith(`${ROUTES_FRONT.APP}/`)
    );
    expect(subPages.length).toBeGreaterThan(20);
    for (const route of subPages) {
      expect(resolveBackFallback(route)).not.toBe(route);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { isLeftToDesktopBounce } from './useLoggedOutEntryGuard';

describe('isLeftToDesktopBounce', () => {
  it('leaves a product route of the desktop redirect context to the /get-app bounce', () => {
    expect(isLeftToDesktopBounce('redirect', ROUTES_FRONT.APP)).toBe(true);
    expect(isLeftToDesktopBounce('redirect', '/app/gallery')).toBe(true);
  });

  it('does NOT leave an account route to it: nothing else moves an anonymous visitor off the account panel', () => {
    expect(isLeftToDesktopBounce('redirect', ROUTES_FRONT.USER_RECOVER)).toBe(
      false
    );
    expect(isLeftToDesktopBounce('redirect', ROUTES_FRONT.USER_ACCOUNT)).toBe(
      false
    );
    expect(isLeftToDesktopBounce('redirect', '/app/user/support')).toBe(false);
  });

  it('never applies outside the redirect context', () => {
    expect(isLeftToDesktopBounce('normal', ROUTES_FRONT.APP)).toBe(false);
    expect(isLeftToDesktopBounce('frame', ROUTES_FRONT.APP)).toBe(false);
  });
});

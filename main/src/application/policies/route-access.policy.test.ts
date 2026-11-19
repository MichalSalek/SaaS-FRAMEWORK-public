import { describe, expect, it } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { resolveRouteAccessCategory } from './route-access.policy';

describe('resolveRouteAccessCategory', () => {
  it('classifies the salon invitations screen as an account route', () => {
    expect(resolveRouteAccessCategory(ROUTES_FRONT.SALON_INVITATIONS)).toBe(
      'account-route'
    );
  });

  it('keeps the account category with a query string (e-mail link)', () => {
    expect(
      resolveRouteAccessCategory(`${ROUTES_FRONT.SALON_INVITATIONS}?utm=mail`)
    ).toBe('account-route');
  });

  it("keeps the owner's salon roster a product route", () => {
    expect(resolveRouteAccessCategory(ROUTES_FRONT.SALON_STAFF)).toBe(
      'product-route'
    );
  });

  it("keeps the stylist's client list and client card product routes", () => {
    expect(resolveRouteAccessCategory(ROUTES_FRONT.CLIENTS)).toBe(
      'product-route'
    );
    expect(resolveRouteAccessCategory('/app/clients/abc')).toBe(
      'product-route'
    );
  });

  it('matches the invitations prefix only at a path boundary', () => {
    expect(resolveRouteAccessCategory('/app/salon/invitations-archive')).toBe(
      'product-route'
    );
  });

  it('leaves static pages ungated', () => {
    expect(resolveRouteAccessCategory('/pricing')).toBe('static');
  });

  it('permits only individual session details on desktop', () => {
    expect(
      resolveRouteAccessCategory('/app/sessions/session-1?from=notification')
    ).toBe('account-route');
    expect(resolveRouteAccessCategory('/app/inbox/session/session-1/')).toBe(
      'account-route'
    );
    expect(resolveRouteAccessCategory('/app/sessions')).toBe('product-route');
    expect(
      resolveRouteAccessCategory('/app/inbox/session/session-1/extra')
    ).toBe('product-route');
  });
});

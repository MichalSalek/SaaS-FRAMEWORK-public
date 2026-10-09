import { describe, it, expect } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { ClientAccount } from '@kernel/models/db_models.generated.dto';
import { resolveOnboardingGateDecision } from './useOnboardingPlanGuard';

// Pure decision for the app-wide onboarding gate (the hook itself only wires
// the side-effect). Prod incident 2026-09-02: a `role_client` user with NO
// ClientAccount row opened /app/client-profile from the drawer and hit the
// profile ERROR screen (404 CLIENT_NOT_FOUND) — the no-account redirect lived
// only on the dashboard. It must now fire from ANY /app route.
//
// ROUTES_FRONT values used in assertions (matching routing.config.ts):
//   ROUTES_FRONT.ONBOARDING      = '/app/onboarding'
//   ROUTES_FRONT.USER_RECOVER    = '/app/user/recover'
//   ROUTES_FRONT.CHECKOUT_RETURN = '/app/checkout/return'

const NO_ACCOUNTS = { stylist_account: null, client_account: null };

const CLIENT_ACCOUNT: ClientAccount = {
  client_account_id: 'client-1',
  created_by_user_id: 'user-1',
  contact_phone: null,
  contact_email: null,
  dashboard_note: null,
  created_at: new Date('2026-09-01T00:00:00.000Z'),
};

const settled = {
  isLoading: false,
  isFetching: false,
  isSessionPending: false,
  isAdmin: false,
  isBecomeUser: false,
  isImpersonatingSync: false,
  recoveryState: 'active' as const,
  planResolved: false,
  query: {},
};

describe('resolveOnboardingGateDecision — no-account case', () => {
  it('bounces a zero-account user to onboarding from a non-dashboard route', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: NO_ACCOUNTS,
      })
    ).toEqual({
      kind: 'redirect',
      target: ROUTES_FRONT.ONBOARDING,
      reason: 'no-account',
    });
  });

  it('forwards a validated ?role hint into the onboarding target', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app',
        query: { role: 'client' },
        currentUser: NO_ACCOUNTS,
      })
    ).toEqual({
      kind: 'redirect',
      target: `${ROUTES_FRONT.ONBOARDING}?role=client`,
      reason: 'no-account',
    });
  });

  it('drops an invalid ?role hint (UX hint only, never trusted)', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app',
        query: { role: 'admin' },
        currentUser: NO_ACCOUNTS,
      })
    ).toEqual({
      kind: 'redirect',
      target: ROUTES_FRONT.ONBOARDING,
      reason: 'no-account',
    });
  });

  it('never bounces onboarding itself nor the other allowlisted routes (loop-safety)', () => {
    for (const pathname of [
      ROUTES_FRONT.ONBOARDING,
      ROUTES_FRONT.USER_RECOVER,
      ROUTES_FRONT.CHECKOUT_RETURN,
    ]) {
      expect(
        resolveOnboardingGateDecision({
          ...settled,
          pathname,
          currentUser: NO_ACCOUNTS,
        })
      ).toEqual({ kind: 'none' });
    }
  });

  it('does nothing while the user is still loading (no redirect on a skeleton)', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: undefined,
        isLoading: true,
      })
    ).toEqual({ kind: 'none' });
    // Resolved-but-refetching (stale snapshot post-onboarding) is also a hold.
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: NO_ACCOUNTS,
        isFetching: true,
      })
    ).toEqual({ kind: 'none' });
    // Session still pending → role_id not hydrated → hold.
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: NO_ACCOUNTS,
        isSessionPending: true,
      })
    ).toEqual({ kind: 'none' });
  });

  it('exempts admins and active impersonation (moderation-only personas)', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: NO_ACCOUNTS,
        isAdmin: true,
      })
    ).toEqual({ kind: 'none' });
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: NO_ACCOUNTS,
        isImpersonatingSync: true,
      })
    ).toEqual({ kind: 'none' });
  });

  it('leaves a client-only user alone (nothing missing, no plan concept)', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: { stylist_account: null, client_account: CLIENT_ACCOUNT },
      })
    ).toEqual({ kind: 'none' });
  });

  it('defers a soft-deleted zero-account user to the recovery guard', () => {
    expect(
      resolveOnboardingGateDecision({
        ...settled,
        pathname: '/app/client-profile',
        currentUser: NO_ACCOUNTS,
        recoveryState: 'recoverable',
      })
    ).toEqual({ kind: 'none' });
  });
});

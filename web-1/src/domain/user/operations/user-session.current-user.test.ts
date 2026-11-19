/**
 * getCurrentUser_IO keeps three outcomes apart:
 * ANONYMOUS (credentials do not resolve), AUTHENTICATED, and UNAVAILABLE (our own
 * infrastructure failed while resolving them). Before, every exception collapsed into the
 * anonymous shape and the middleware answered a database outage with 401 LOGIN_FIRST.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { APIError } from 'better-auth/api';
import { makeStylistAccount, makeUser } from '../../../test-utils/fixtures';

// setup.ts replaces this module with inert stubs for handler tests; this file
// exercises the real implementation.
vi.unmock('@domain/user/operations/user-session.operations');

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser_IO: vi.fn(),
  resolveRequestEffectivePlan_IO: vi.fn(),
}));

vi.mock('@app/auth/better-auth/better-auth.config', () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock('./user-crud.operations', () => ({ getUser_IO: mocks.getUser_IO }));
vi.mock('@app/pricing/effective-plan.resolver', () => ({
  resolveRequestEffectivePlan_IO: mocks.resolveRequestEffectivePlan_IO,
}));

import { getCurrentUser_IO } from './user-session.operations';

const USER = makeUser();
const BA_RESULT = {
  user: { id: USER.id },
  session: {
    id: 'sess_1',
    token: 'tok_live',
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
};

const call = () =>
  getCurrentUser_IO({
    req: {
      headers: { authorization: 'Bearer tok_live' },
    } as unknown as NextApiRequest,
    res: {} as NextApiResponse,
  });

describe('getCurrentUser_IO outcomes', () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.getUser_IO.mockReset();
    mocks.resolveRequestEffectivePlan_IO.mockReset();
    mocks.resolveRequestEffectivePlan_IO.mockResolvedValue({});
  });

  it('getSession throwing a database error -> UNAVAILABLE at SESSION (not anonymous)', async () => {
    mocks.getSession.mockRejectedValue(
      new Error('relation "Session" does not exist')
    );
    const out = await call();
    expect(out).toEqual({ status: 'UNAVAILABLE', stage: 'SESSION' });
  });

  it('getSession throwing Better Auth 500 (wrapped adapter failure) -> UNAVAILABLE', async () => {
    mocks.getSession.mockRejectedValue(
      new APIError('INTERNAL_SERVER_ERROR', {
        message: 'FAILED_TO_GET_SESSION',
      })
    );
    const out = await call();
    expect(out).toEqual({ status: 'UNAVAILABLE', stage: 'SESSION' });
  });

  it('Better Auth refusing the session (401 APIError) -> ANONYMOUS', async () => {
    mocks.getSession.mockRejectedValue(
      new APIError('UNAUTHORIZED', { message: 'FAILED_TO_GET_SESSION' })
    );
    const out = await call();
    expect(out.status).toBe('ANONYMOUS');
  });

  it('no session -> ANONYMOUS', async () => {
    mocks.getSession.mockResolvedValue(null);
    const out = await call();
    expect(out.status).toBe('ANONYMOUS');
    expect(mocks.getUser_IO).not.toHaveBeenCalled();
  });

  it('getUser_IO throwing -> UNAVAILABLE at USER', async () => {
    mocks.getSession.mockResolvedValue(BA_RESULT);
    mocks.getUser_IO.mockRejectedValue(new Error('connection terminated'));
    const out = await call();
    expect(out).toEqual({ status: 'UNAVAILABLE', stage: 'USER' });
  });

  it('confirmed session whose user row is gone -> ANONYMOUS', async () => {
    mocks.getSession.mockResolvedValue(BA_RESULT);
    mocks.getUser_IO.mockResolvedValue(null);
    const out = await call();
    expect(out.status).toBe('ANONYMOUS');
  });

  it('effective plan read throwing -> UNAVAILABLE at PLAN (never served on a partial plan)', async () => {
    mocks.getSession.mockResolvedValue(BA_RESULT);
    mocks.getUser_IO.mockResolvedValue({
      ...USER,
      stylist_account: makeStylistAccount({ created_by_user_id: USER.id }),
      client_account: null,
    });
    mocks.resolveRequestEffectivePlan_IO.mockRejectedValue(
      new Error('relation "StaffMember" does not exist')
    );
    const out = await call();
    expect(out).toEqual({ status: 'UNAVAILABLE', stage: 'PLAN' });
  });

  it('confirmed session and user -> AUTHENTICATED with the mapped session', async () => {
    mocks.getSession.mockResolvedValue(BA_RESULT);
    mocks.getUser_IO.mockResolvedValue({
      ...USER,
      stylist_account: null,
      client_account: null,
    });
    const out = await call();
    expect(out.status).toBe('AUTHENTICATED');
    if (out.status !== 'AUTHENTICATED') {
      return;
    }
    expect(out.output.user.id).toBe(USER.id);
    expect(out.output.session.token).toBe('tok_live');
    expect(out.output.currentUser.id).toBe(USER.id);
  });

  it('stylist -> the live effective plan is merged into her account (read every request, no cache)', async () => {
    mocks.getSession.mockResolvedValue(BA_RESULT);
    const stylist_account = makeStylistAccount({ created_by_user_id: USER.id });
    mocks.getUser_IO.mockResolvedValue({
      ...USER,
      stylist_account,
      client_account: null,
    });
    mocks.resolveRequestEffectivePlan_IO.mockResolvedValue({
      effective_pricing_plan: 'STUDIO',
      salon_plan: null,
    });
    await call();
    await call();
    expect(mocks.resolveRequestEffectivePlan_IO).toHaveBeenCalledTimes(2);
    expect(mocks.resolveRequestEffectivePlan_IO).toHaveBeenCalledWith({
      userId: USER.id,
      ownPlan: stylist_account.pricing_plan,
    });
    const out = await call();
    expect(out.status).toBe('AUTHENTICATED');
    if (out.status === 'AUTHENTICATED') {
      expect(out.output.user.stylist_account?.effective_pricing_plan).toBe(
        'STUDIO'
      );
    }
  });
});

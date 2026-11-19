import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '../../pages/api/v1/salon/invitations/token/accept/index';
import { mockDb } from '../mockApiHandler';
import { __resetCurrentUser, __setCurrentUser } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { invalidateFeatureFlagCache } from '@app/feature-flags/feature-flags.cache';
const token = 'a'.repeat(43);
beforeEach(() => {
  __resetCurrentUser();
  invalidateFeatureFlagCache();
});
const install = () => {
  let reads = 0;
  const createSession = vi.fn();
  mockDb({
    impersonationBackup: { findFirst: async () => null },
    featureFlag: {
      findMany: async () => [
        { key: FEATURE_FLAG_KEYS.SALON_STAFF_ENABLED, is_enabled: true },
      ],
    },
    salonInvitation: {
      findUnique: async () =>
        ++reads === 1
          ? {
              id: 'inv',
              email: 'new@example.com',
              expires_at: new Date(Date.now() + 10000),
              accepted_at: null,
              declined_at: null,
              salon: {
                business_name: 'Salon',
                display_name: 'Owner',
                created_by_user: { is_active: true, disabled_at: null },
              },
            }
          : { accepted_at: new Date(), declined_at: null },
      updateMany: async () => ({ count: 1 }),
    },
    user: { findFirst: async () => null },
    session: { create: createSession },
  });
  return createSession;
};
describe('public invitation consent endpoint security', () => {
  it('accepts without issuing an authorization header, cookie or session', async () => {
    const createSession = install();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      url: '/api/v1/salon/invitations/token/accept',
      body: { token },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res.getHeader('authorization')).toBeUndefined();
    expect(res.getHeader('set-cookie')).toBeUndefined();
    expect(createSession).not.toHaveBeenCalled();
  });
  it('rejects a different signed-in account before acceptance', async () => {
    install();
    __setCurrentUser(
      makeCurrentUserOutput(
        makeStylistCurrentUser({ user: { email: 'other@example.com' } })
      )
    );
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'POST',
      url: '/api/v1/salon/invitations/token/accept',
      headers: { authorization: 'Bearer test-existing-session' },
      body: { token },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(res.getHeader('authorization')).toBeUndefined();
    expect(res._getJSONData()).toMatchObject({
      data: { message: 'WRONG_EMAIL' },
    });
  });
});

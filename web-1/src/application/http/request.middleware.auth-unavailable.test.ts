/**
 * An infrastructure failure while resolving WHO is asking must
 * answer 503 AUTH_UNAVAILABLE + Retry-After, never a false 401 LOGIN_FIRST (the client deletes its
 * token on that event) or a false 403, and never run the business logic. Honest verdicts stay:
 * no session -> 401 LOGIN_FIRST, a real refusal -> 403 UNAUTHORIZED.
 *
 * Runs the REAL middleware and the REAL permissions.cache (permission holder `null`); only the
 * auth chokepoint and the DB are stubbed (setup.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NO_VALIDATION } from '@kernel/policies/validation.policy';
import { AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS } from '@kernel/application/auth/auth.config';
import { mockDb } from '../../test-utils/mockApiHandler';
import {
  __resetCurrentUser,
  __setAuthUnavailable,
  __setCurrentUser,
  __setPermission,
} from '../../test-utils/setup';
import {
  makeClientCurrentUser,
  makeCurrentUserOutput,
} from '../../test-utils/fixtures';
import { HTTPRequestHandlerMiddleware } from './request.middleware';

const EVENT = APP_EVENTS.QUERIES.FAVORITE.FAVORITE_GET_RECORDS;
const CUSTOM_ROLE_ID = 'role_custom_review_f2';

const run = async () => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    url: '/api/v1/favorite/get-records',
  });
  const businessLogic = vi.fn(async () => {
    res.status(200).json({ event: 'FAVORITE_RECORDS_FETCHED', data: null });
  });
  await HTTPRequestHandlerMiddleware(req, res, {
    contestedHTTPMethod: 'get',
    eventName: EVENT,
    validationFunction: NO_VALIDATION,
    businessLogic,
  });
  const body = res._getJSONData() as { event?: unknown; data?: unknown };
  return {
    status: res._getStatusCode(),
    event: body.event,
    data: body.data,
    retryAfter: res.getHeader('Retry-After'),
    businessLogic,
  };
};

// A custom role is not representable in the SystemRoleId type, yet the DB can hold one; the
// runtime value is what the permission path reads.
const customRoleClient = () =>
  Object.assign(makeClientCurrentUser(), { role_id: CUSTOM_ROLE_ID });

const failingRolePermissionRead = () =>
  mockDb({
    rolePermission: {
      findFirst: async () => {
        throw new Error('relation "RolePermission" does not exist');
      },
    },
  });

describe('request.middleware: auth infrastructure failure', () => {
  beforeEach(() => {
    __resetCurrentUser();
    __setPermission(null);
  });

  it.each(['SESSION', 'USER', 'PLAN'] as const)(
    'session resolution UNAVAILABLE at %s -> 503 AUTH_UNAVAILABLE + Retry-After, logic not run',
    async stage => {
      __setAuthUnavailable(stage);
      const out = await run();
      expect(out.status).toBe(503);
      expect(out.event).toBe(APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE);
      expect(out.retryAfter).toBe(AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS);
      expect(out.data).toEqual({
        retryAfter: AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
      expect(out.businessLogic).not.toHaveBeenCalled();
    }
  );

  it('custom-role permission read failure -> 503, never 403 and never a grant', async () => {
    __setCurrentUser(makeCurrentUserOutput(customRoleClient()));
    failingRolePermissionRead();
    const out = await run();
    expect(out.status).toBe(503);
    expect(out.event).toBe(APP_EVENTS.INFO.SESSION.AUTH_UNAVAILABLE);
    expect(out.retryAfter).toBe(AUTH_UNAVAILABLE_RETRY_AFTER_SECONDS);
    expect(out.businessLogic).not.toHaveBeenCalled();
  });

  it('custom role with no matching permission row -> 403 UNAUTHORIZED (real refusal)', async () => {
    __setCurrentUser(makeCurrentUserOutput(customRoleClient()));
    mockDb({ rolePermission: { findFirst: async () => null } });
    const out = await run();
    expect(out.status).toBe(403);
    expect(out.event).toBe(APP_EVENTS.INFO.USER.UNAUTHORIZED);
    expect(out.businessLogic).not.toHaveBeenCalled();
  });

  it('custom role with a permission row -> business logic runs', async () => {
    __setCurrentUser(makeCurrentUserOutput(customRoleClient()));
    mockDb({
      rolePermission: { findFirst: async () => ({ id: 'rp_1' }) },
    });
    const out = await run();
    expect(out.status).toBe(200);
    expect(out.businessLogic).toHaveBeenCalledTimes(1);
  });

  it('system role is answered without the permission DB read (works while it is broken)', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    failingRolePermissionRead();
    const out = await run();
    expect(out.status).toBe(200);
    expect(out.businessLogic).toHaveBeenCalledTimes(1);
  });

  it('no session -> 401 LOGIN_FIRST (honest verdict unchanged)', async () => {
    const out = await run();
    expect(out.status).toBe(401);
    expect(out.event).toBe(APP_EVENTS.INFO.USER.LOGIN_FIRST);
    expect(out.retryAfter).toBeUndefined();
  });
});

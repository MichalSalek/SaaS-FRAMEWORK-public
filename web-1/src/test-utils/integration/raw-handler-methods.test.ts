/**
 * Method gate of the RAW handler wrappers (`withPublicHandler`, `withRawSecretHandler`).
 *
 * `allowedMethods` used to be documentation only; every raw handler re-implemented its own gate
 * and the Stripe webhook answered a GET with 400. The wrappers now enforce it:
 * a method outside the list gets 405 with `Allow`, unless the handler declares a deliberate other
 * answer (an opaque 404 that hides the endpoint, the token bridge's 406). What must NOT change:
 * the CORS preflight is answered before the gate, the secret masks (opaque 404) come before it,
 * and `failClosedMode: 'custom'` (dev-login) is not gated by the wrapper at all, because a 405 in
 * front of its 404 mask would reveal the endpoint.
 */

import { describe, expect, it, vi } from 'vitest';
import { createMocks, type RequestMethod } from 'node-mocks-http';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  withPublicHandler,
  withRawSecretHandler,
} from '@app/http/define-raw-handler';

// Better Auth initialises against the database at import; the rejected methods never reach it.
vi.mock('@app/auth/better-auth/better-auth.config', () => ({
  auth: { api: { signInSocial: vi.fn() } },
}));
vi.mock('@app/scheduler/scheduler.instance', () => ({
  appScheduler: { decideTick: vi.fn(), runRound: vi.fn() },
}));
vi.mock('@app/scheduler/scheduler-heartbeat', () => ({
  pingSchedulerHeartbeat: vi.fn(),
}));

import healthCheck from '../../pages/api/health-check/index';
import healthPublic from '../../pages/api/v1/internal/health-public/index';
import sweepTick from '../../pages/api/v1/internal/sweep-tick/index';
import trackCrawler from '../../pages/api/v1/internal/track-crawler/index';
import exchangeCode from '../../pages/api/auth/exchange-code/index';
import nativeOauthStart from '../../pages/api/auth/native-oauth-start/[provider]';
import stripeWebhook from '../../pages/api/v1/webhooks/stripe/index';
import devLogin from '../../pages/api/auth/dev-login/index';

const VALID_SECRET = 'test-internal-shared-secret-0123456789';

type Sent = {
  status: number;
  allow: string | undefined;
  event: string | undefined;
};

const call = async (
  handler: NextApiHandler,
  method: RequestMethod,
  options: { headers?: Record<string, string>; url?: string } = {}
): Promise<Sent> => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method,
    url: options.url ?? '/api/v1/test',
    ...(options.headers !== undefined && { headers: options.headers }),
  });
  await handler(req, res);
  const allow = res.getHeader('Allow');
  let event: string | undefined;
  try {
    const body: unknown = res._getJSONData();
    if (typeof body === 'object' && body !== null && 'event' in body) {
      event = typeof body.event === 'string' ? body.event : undefined;
    }
  } catch {
    event = undefined;
  }
  return {
    status: res._getStatusCode(),
    allow: typeof allow === 'string' ? allow : undefined,
    event,
  };
};

const reached = vi.fn();
const okHandle = (_req: NextApiRequest, res: NextApiResponse): void => {
  reached();
  res.status(200).json({ event: 'OK' });
};

describe('withPublicHandler: allowedMethods is enforced', () => {
  const probe = withPublicHandler({
    allowedMethods: ['GET', 'HEAD'],
    cors: false,
    rateLimit: false,
    handle: okHandle,
  });

  it('answers a method outside the list with 405 + Allow and never runs handle', async () => {
    reached.mockClear();
    const sent = await call(probe, 'POST');
    expect(sent).toEqual({
      status: 405,
      allow: 'GET, HEAD',
      event: APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO,
    });
    expect(reached).not.toHaveBeenCalled();
  });

  it('lets a listed method through', async () => {
    reached.mockClear();
    expect((await call(probe, 'HEAD')).status).toBe(200);
    expect(reached).toHaveBeenCalledTimes(1);
  });

  it('with CORS on, still answers the preflight (204) and advertises OPTIONS in Allow', async () => {
    const browserFacing = withPublicHandler({
      allowedMethods: ['POST'],
      rateLimit: false,
      handle: okHandle,
    });
    expect((await call(browserFacing, 'OPTIONS')).status).toBe(204);
    const rejected = await call(browserFacing, 'DELETE');
    expect(rejected.status).toBe(405);
    expect(rejected.allow).toBe('POST, OPTIONS');
  });

  it('uses the declared answer instead of 405 when the handler has one', async () => {
    const masked = withPublicHandler({
      allowedMethods: ['GET'],
      cors: false,
      rateLimit: false,
      onMethodNotAllowed: res => {
        res.status(404).end();
      },
      handle: okHandle,
    });
    const sent = await call(masked, 'POST');
    expect(sent.status).toBe(404);
    expect(sent.allow).toBeUndefined();
  });
});

describe('withRawSecretHandler: the gate never comes before a secret mask', () => {
  const secretGated = withRawSecretHandler({
    allowedMethods: ['POST'],
    failClosedMode: 'opaque-404',
    onMissingSecret: res => {
      res.status(503).end();
    },
    handle: okHandle,
  });

  it('an outsider on a wrong method still gets the opaque 404, not 405', async () => {
    const sent = await call(secretGated, 'GET');
    expect(sent.status).toBe(404);
    expect(sent.allow).toBeUndefined();
  });

  it('an authenticated caller on a wrong method gets 405 + Allow', async () => {
    const sent = await call(secretGated, 'GET', {
      headers: { 'x-internal-secret': VALID_SECRET },
    });
    expect(sent.status).toBe(405);
    expect(sent.allow).toBe('POST');
  });

  it("'custom' mode is not gated by the wrapper (the handler owns the mask and the method)", async () => {
    reached.mockClear();
    const custom = withRawSecretHandler({
      allowedMethods: ['POST'],
      failClosedMode: 'custom',
      handle: okHandle,
    });
    expect((await call(custom, 'GET')).status).toBe(200);
    expect(reached).toHaveBeenCalledTimes(1);
  });
});

describe('real raw routes', () => {
  it('health-check: 405 + Allow for a write, its own OPTIONS contract stays 200', async () => {
    const rejected = await call(healthCheck, 'DELETE');
    expect(rejected.status).toBe(405);
    expect(rejected.allow).toBe('GET, HEAD, OPTIONS');
    expect((await call(healthCheck, 'OPTIONS')).status).toBe(200);
  });

  it('health-public and sweep-tick: 405 + Allow GET, HEAD', async () => {
    for (const handler of [healthPublic, sweepTick]) {
      const sent = await call(handler, 'POST');
      expect(sent.status).toBe(405);
      expect(sent.allow).toBe('GET, HEAD');
    }
  });

  it('track-crawler: opaque 404 without the secret, 405 + Allow with it', async () => {
    expect((await call(trackCrawler, 'GET')).status).toBe(404);
    const authed = await call(trackCrawler, 'GET', {
      headers: { 'x-internal-secret': VALID_SECRET },
    });
    expect(authed.status).toBe(405);
    expect(authed.allow).toBe('POST');
  });

  it('Stripe webhook: a non-POST gets 405 + Allow POST (the raw body path is untouched)', async () => {
    const sent = await call(stripeWebhook, 'GET');
    expect(sent.status).toBe(405);
    expect(sent.allow).toBe('POST');
  });

  it('exchange-code keeps its 406 contract for a wrong method', async () => {
    const sent = await call(exchangeCode, 'GET', {
      url: '/api/auth/exchange-code',
    });
    expect(sent.status).toBe(406);
    expect(sent.event).toBe(APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO);
  });

  it('native-oauth-start keeps the opaque 404 for a wrong method', async () => {
    const sent = await call(nativeOauthStart, 'POST', {
      url: '/api/auth/native-oauth-start/google',
    });
    expect(sent.status).toBe(404);
    expect(sent.allow).toBeUndefined();
  });

  it('dev-login without the secret answers 404 to any method (mask before method)', async () => {
    const sent = await call(devLogin, 'GET', { url: '/api/auth/dev-login' });
    expect(sent.status).toBe(404);
    expect(sent.allow).toBeUndefined();
  });
});

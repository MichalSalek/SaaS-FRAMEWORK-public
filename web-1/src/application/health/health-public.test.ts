import { createMocks, type RequestMethod } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  observePrimaryDatabaseRelease,
  observePrimaryDatabaseError,
  resetPrimaryDatabaseAvailabilityForTests,
} from '@app/db/db-availability.state';
import { mockApiHandler } from '../../test-utils/mockApiHandler';
import databaseHealthHandler from '../../pages/api/health/database';
import healthPublicHandler from '../../pages/api/v1/internal/health-public';

describe('health-public passive DB status', () => {
  beforeEach(() => resetPrimaryDatabaseAvailabilityForTests());

  it('returns the observed pool state without touching DB_CLIENT', async () => {
    observePrimaryDatabaseRelease();
    const up = await mockApiHandler<{
      database: string;
      api: string;
    }>(healthPublicHandler, { method: 'GET' });
    expect(up.data).toMatchObject({ database: 'up', api: 'up' });

    observePrimaryDatabaseError({ code: 'P1001' });
    const down = await mockApiHandler<{
      database: string;
      api: string;
    }>(healthPublicHandler, { method: 'GET' });
    expect(down.data).toMatchObject({ database: 'down', api: 'up' });
  });

  it('exposes the same passive state on the stable Better Stack route', async () => {
    observePrimaryDatabaseRelease();

    const response = await mockApiHandler<{
      database: string;
      api: string;
    }>(databaseHealthHandler, { method: 'GET' });

    expect(response.data).toMatchObject({ database: 'up', api: 'up' });
  });
});

/**
 * Monitory uptime (Better Stack, `curl -I`) pingują HEAD-em — do fixu dostawały 405 i
 * raportowały fałszywy DOWN. `mockApiHandler` nie wystawia nagłówków odpowiedzi, więc
 * bramkę metody sprawdzamy sterując handlerem bezpośrednio.
 */
describe('health-public method gate', () => {
  const invoke = async (method: RequestMethod) => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method,
      url: '/api/v1/internal/health-public',
    });
    await healthPublicHandler(req, res);
    return res;
  };

  it('odpowiada 200 na HEAD i nie wysyła ciała', async () => {
    const res = await invoke('HEAD');

    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toBe('');
    expect(res.getHeader('content-type')).toBe(
      'application/json; charset=utf-8'
    );
  });

  it('odrzuca POST przez 405 z nagłówkiem Allow', async () => {
    const res = await invoke('POST');

    expect(res._getStatusCode()).toBe(405);
    expect(res.getHeader('allow')).toBe('GET, HEAD');
  });
});

import { createMocks, type RequestMethod } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import healthCheckHandler from '../../pages/api/health-check';
import { mockApiHandler } from '../../test-utils/mockApiHandler';
import { getBuildId } from './build-id';

describe('health-check deploy liveness', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns process uptime without requiring database access', async () => {
    vi.spyOn(process, 'uptime').mockReturnValue(42.4);

    const response = await mockApiHandler<{
      status: string;
      uptime_seconds: number;
      build_id: string;
    }>(healthCheckHandler, { method: 'GET' });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      status: 'APP_OK',
      uptime_seconds: 42,
      build_id: getBuildId(),
    });
  });

  /**
   * Kontrakt deploy-gate'u: `scripts/deploy/deploy-backend` wyciąga build_id sedem
   * z surowego JSON-a i porównuje z lokalnym `.next/BUILD_ID`. Pole MUSI istnieć i
   * być niepustym stringiem — bez niego gate degraduje do „świeży proces", czyli do
   * dokładnie tego fałszywego zielonego, który to pole eliminuje.
   */
  it('zawsze raportuje niepuste build_id (kontrakt deploy-gate)', async () => {
    const response = await mockApiHandler<{ build_id: string }>(
      healthCheckHandler,
      { method: 'GET' }
    );

    expect(typeof response.data.build_id).toBe('string');
    expect(response.data.build_id.length).toBeGreaterThan(0);
  });
});

/**
 * HEAD to dokładnie to, co wysyłają monitory uptime i `curl -I` — wcześniej dostawały
 * 405 (fałszywy DOWN). `mockApiHandler` nie wystawia nagłówków odpowiedzi, więc te dwa
 * testy sterują handlerem bezpośrednio przez node-mocks-http.
 */
describe('health-check method gate', () => {
  const invoke = async (method: RequestMethod) => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method,
      url: '/api/health-check',
    });
    await healthCheckHandler(req, res);
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

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
   * Deploy-gate contract: `scripts/deploy/deploy-backend` pulls build_id from the
   * raw JSON and compares it with the local `.next/BUILD_ID`. The field must be a
   * non-empty string. Without it the gate falls back to "fresh process", the false
   * green this field exists to remove.
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
 * HEAD is what uptime monitors and `curl -I` send. They used to get 405, a false
 * DOWN. `mockApiHandler` does not expose response headers, so these two tests
 * drive the handler through node-mocks-http.
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
    // OPTIONS is listed too: this probe answers its own preflight (200).
    expect(res.getHeader('allow')).toBe('GET, HEAD, OPTIONS');
  });
});

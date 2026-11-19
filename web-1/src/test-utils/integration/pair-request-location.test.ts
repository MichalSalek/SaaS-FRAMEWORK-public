import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENV_VARS } from '@app/environment/environment.config';
import { makeClientCurrentUser, makeCurrentUserOutput } from '../fixtures';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import handler from '../../pages/api/v1/pairing/request-pair/index';

const ops = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@domain/pairing/operations/pair-request.operations', () => ({
  createPairRequest_IO: ops.create,
}));

const client = makeClientCurrentUser();
const mutableEnv = ENV_VARS as { TRUSTED_EDGE: string };
const previousEdge = ENV_VARS.TRUSTED_EDGE;
const headers = {
  host: `api.${BRAND_CONFIG.domain}`,
  'cf-ray': 'a4eb72230936512f-WAW',
  'cf-connecting-ip': '203.0.113.10',
  'cf-ipcity': 'Krak%C3%B3w',
};

beforeEach(() => {
  mutableEnv.TRUSTED_EDGE = 'cloudflare';
  __setCurrentUser(makeCurrentUserOutput(client));
  __setPermission(true);
  ops.create.mockReset().mockResolvedValue({
    success: true,
    data: {
      status: 'PENDING',
      display_name: 'Ola',
      created: false,
      pair_id: 'pair-1',
    },
  });
});
afterEach(() => {
  mutableEnv.TRUSTED_EDGE = previousEdge;
});

describe('request-pair location enrichment', () => {
  it.each([
    [{}, 'Kraków'],
    [{ place: '  Warszawa  ' }, 'Warszawa'],
  ])(
    'forwards parsed request place or safe edge fallback %#',
    async (details, expected) => {
      const result = await mockApiHandler(handler, {
        method: 'POST',
        body: { stylist_account_id: 'stylist-1', ...details },
        headers,
      });
      expect(result.status).toBe(200);
      expect(ops.create).toHaveBeenCalledWith({
        client_user_id: client.id,
        stylist_account_id: 'stylist-1',
        place: expected,
      });
    }
  );

  it('sends no place when the edge is untrusted and still accepts the request', async () => {
    const result = await mockApiHandler(handler, {
      method: 'POST',
      body: { stylist_account_id: 'stylist-1' },
      headers: { ...headers, host: 'web-1.onrender.com' },
    });
    expect(result.status).toBe(200);
    expect(ops.create).toHaveBeenCalledWith({
      client_user_id: client.id,
      stylist_account_id: 'stylist-1',
    });
  });
});

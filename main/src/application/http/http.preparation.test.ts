import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callHTTPEndpoint } from './http.possibilities.api';

const spies = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  headers: vi.fn(),
}));
vi.mock('./http.interceptor', () => ({ interceptors: spies }));
vi.mock('./http.utils', () => ({ requestHeadersSetter: async () => ({}) }));

describe('HTTP transport failure provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('reports serialization failure as a client defect before any network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const payload: { self?: unknown } = {};
    payload.self = payload;
    await callHTTPEndpoint({
      config: { url: () => 'https://example.test/api', mode: 'post', payload },
      successCallback: async () => undefined,
      errorCallback: async () => undefined,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spies.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'ERR_CLIENT_REQUEST',
          stack: expect.any(String),
        }),
      })
    );
    fetchSpy.mockRestore();
  });
  it('preserves a genuine fetch failure as a network failure', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await callHTTPEndpoint({
      config: { url: () => 'https://example.test/api', mode: 'get' },
      successCallback: async () => undefined,
      errorCallback: async () => undefined,
    });
    expect(spies.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: { message: 'Failed to fetch' } })
    );
    fetchSpy.mockRestore();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindDocumentCredentials } from '../auth/document-credentials';
import { callHTTPEndpoint } from './http.possibilities.api';
import { checkedDocumentCredentials } from '../auth/document-credentials';
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend: vi.fn(),
}));
vi.mock('../event-bus/eventBus.possibilities.api', () => ({
  pushEventToBus: vi.fn(async () => undefined),
}));
const config = {
  url: () => 'http://example.invalid/private',
  mode: 'post' as const,
  payload: { private: 'draft' },
};
describe('document credential binding', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('authorization', 'person-a');
    bindDocumentCredentials();
  });
  it('rejects before fetch when the bearer changes before the storage event', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    localStorage.setItem('authorization', 'person-b');
    const success = vi.fn(),
      error = vi.fn();
    await callHTTPEndpoint({
      config,
      successCallback: success,
      errorCallback: error,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(localStorage.getItem('authorization')).toBe('person-b');
  });
  it('drops a stale response without applying its headers or success callback', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>(r => {
          resolve = r;
        })
    );
    vi.stubGlobal('fetch', fetcher);
    const success = vi.fn(),
      error = vi.fn();
    const running = callHTTPEndpoint({
      config,
      successCallback: success,
      errorCallback: error,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      authorization: 'Bearer person-a',
    });
    localStorage.setItem('authorization', 'person-b');
    resolve(
      new Response(JSON.stringify({ event: 'APPLICATION_SUCCESS', data: {} }), {
        status: 200,
        headers: { authorization: 'stale-response' },
      })
    );
    await running;
    expect(success).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(localStorage.getItem('authorization')).toBe('person-b');
  });
  it('captures an exchanged token in memory when another bearer arrives during the request', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>(r => {
          resolve = r;
        })
    );
    vi.stubGlobal('fetch', fetcher);
    const capture = vi.fn(),
      success = vi.fn(),
      error = vi.fn();
    const running = callHTTPEndpoint({
      config: { ...config, captureResponseAuthorization: capture },
      successCallback: success,
      errorCallback: error,
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    localStorage.setItem('authorization', 'person-b');
    resolve(
      new Response(JSON.stringify({ event: 'APPLICATION_SUCCESS', data: {} }), {
        status: 200,
        headers: { authorization: 'unconfirmed' },
      })
    );
    await running;
    expect(capture).toHaveBeenCalledWith('unconfirmed');
    expect(success).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(localStorage.getItem('authorization')).toBe('person-b');
  });
  it('lets a fresh login establish its new bearer for the same document', async () => {
    localStorage.clear();
    bindDocumentCredentials();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ event: 'APPLICATION_SUCCESS', data: {} }),
            { status: 200, headers: { authorization: 'login-token' } }
          )
      )
    );
    const success = vi.fn(),
      error = vi.fn();
    await callHTTPEndpoint({
      config,
      successCallback: success,
      errorCallback: error,
    });
    expect(success).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(checkedDocumentCredentials()?.authorization).toBe('login-token');
  });
  it('completes impersonation response but fences old UI until the full navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ event: 'APPLICATION_SUCCESS', data: {} }),
            {
              status: 200,
              headers: {
                authorization: 'person-b',
                'become-user': 'admin-backup',
              },
            }
          )
      )
    );
    const success = vi.fn(),
      error = vi.fn();
    await callHTTPEndpoint({
      config,
      successCallback: success,
      errorCallback: error,
    });
    expect(success).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    expect(localStorage.getItem('authorization')).toBe('person-b');
    expect(sessionStorage.getItem('become-user')).toBe('admin-backup');
    expect(checkedDocumentCredentials()).toBeNull();
  });
  it('keeps the document usable when the same bearer refreshes its impersonation backup', async () => {
    sessionStorage.setItem('become-user', 'old-backup');
    bindDocumentCredentials();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ event: 'APPLICATION_SUCCESS', data: {} }),
            { status: 200, headers: { 'become-user': 'refreshed-backup' } }
          )
      )
    );
    const success = vi.fn();
    await callHTTPEndpoint({
      config,
      successCallback: success,
      errorCallback: vi.fn(),
    });
    expect(success).toHaveBeenCalledOnce();
    expect(checkedDocumentCredentials()).toEqual({
      authorization: 'person-a',
      becomeUser: 'refreshed-backup',
    });
  });
});

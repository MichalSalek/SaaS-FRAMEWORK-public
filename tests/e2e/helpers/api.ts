// tests/e2e/helpers/api.ts
//
// Lightweight typed API client for e2e tests — used to perform setup/cleanup
// side-channel operations (seed a resource, delete created data) without
// going through the UI.
//
// Keeps a small surface because the canonical API client for smoke tests
// lives in tests/utils/api-client.ts. We do NOT reuse that one here because
// it pulls in dotenv + config side-effects designed for the smoke runner.

import { E2E_ENV } from './env';

export type ApiResult<T = unknown> = {
  status: number;
  ok: boolean;
  body: T;
};

type CallOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  token?: string;
  body?: Record<string, unknown> | undefined;
  headers?: Record<string, string>;
};

/**
 * Issue an authenticated API call against the backend. Returns the parsed
 * envelope (or raw text for non-JSON responses) instead of throwing on 4xx —
 * tests should assert on `result.status` so cleanup paths can tolerate
 * "already deleted" responses.
 */
export async function apiCall<T = unknown>(
  endpoint: string,
  options: CallOptions = {}
): Promise<ApiResult<T>> {
  const url = `${E2E_ENV.BACKEND_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: E2E_ENV.ORIGIN,
    ...(options.headers ?? {}),
  };
  if (options.token) {
    headers['authorization'] = `Bearer ${options.token}`;
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : null,
  });

  let body: T;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    body = (await response.json()) as T;
  } else {
    body = (await response.text()) as unknown as T;
  }

  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

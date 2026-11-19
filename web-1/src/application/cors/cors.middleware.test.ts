import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./cors.config', () => ({
  CORS_ALLOWED_ORIGINS: ['https://front-a.example', 'https://front-b.example'],
  CORS_HEADERS_KEYS: ['Access-Control-Allow-Credentials'],
  CORS_HEADERS_VALUES: ['true'],
}));

vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
}));

import { isAllowedOrigin, setCORSHeaders } from './cors.middleware';

function responseForOrigin(origin: string, vary?: string | string[]) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    headers: { origin },
  });
  if (vary !== undefined) {
    res.setHeader('Vary', vary);
  }
  return { req, res };
}

function getStringHeader(res: NextApiResponse, name: string): string {
  const value = res.getHeader(name);
  if (typeof value !== 'string') {
    throw new Error(`Expected ${name} to be a string header`);
  }
  return value;
}

describe('setCORSHeaders cache variation', () => {
  it('keeps reflected responses separate for two allowed origins and preserves Vary tokens', () => {
    const first = responseForOrigin(
      'https://front-a.example',
      'Accept-Encoding, Accept-Language'
    );
    const second = responseForOrigin(
      'https://front-b.example',
      'Accept-Encoding, Accept-Language'
    );

    expect(isAllowedOrigin(first)).toBe(true);
    expect(isAllowedOrigin(second)).toBe(true);
    setCORSHeaders(first);
    setCORSHeaders(second);

    expect(getStringHeader(first.res, 'Access-Control-Allow-Origin')).toBe(
      'https://front-a.example'
    );
    expect(getStringHeader(second.res, 'Access-Control-Allow-Origin')).toBe(
      'https://front-b.example'
    );
    expect(getStringHeader(first.res, 'Vary')).toBe(
      'Accept-Encoding, Accept-Language, Origin'
    );
    expect(getStringHeader(second.res, 'Vary')).toBe(
      'Accept-Encoding, Accept-Language, Origin'
    );
  });

  it('merges Origin case-insensitively without duplicate Vary tokens', () => {
    const response = responseForOrigin(
      'https://front-a.example',
      'ACCEPT-ENCODING, origin, Accept-Encoding'
    );

    setCORSHeaders(response);

    expect(getStringHeader(response.res, 'Vary')).toBe(
      'ACCEPT-ENCODING, origin'
    );
  });

  it('leaves an existing wildcard Vary unchanged', () => {
    const response = responseForOrigin('https://front-a.example', '*');

    setCORSHeaders(response);

    expect(getStringHeader(response.res, 'Vary')).toBe('*');
  });

  it('varies on Origin when the request has no Origin header too', () => {
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
    });
    res.setHeader('Vary', 'Accept-Encoding');

    setCORSHeaders({ req, res });

    expect(getStringHeader(res, 'Vary')).toBe('Accept-Encoding, Origin');
  });

  it('does not allow an origin outside the configured list', () => {
    const response = responseForOrigin('https://unlisted.example');

    expect(isAllowedOrigin(response)).toBe(false);
  });
});

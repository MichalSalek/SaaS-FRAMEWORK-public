import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, expect, it } from 'vitest';
import { withTimingNextHandlerMiddleware } from './timing.middleware';

/**
 * `x-request-id` przychodzi od nieuwierzytelnionego klienta i trafia do łańcucha
 * korelacji logów — te testy pilnują, że tylko wartość w naszym formacie jest
 * przepuszczana, a wszystko inne dostaje świeżo wygenerowany identyfikator.
 */
const runWithRequestId = async (
  requestId?: string
): Promise<string | undefined> => {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'GET',
    url: '/api/v1/test',
    ...(requestId !== undefined && { headers: { 'x-request-id': requestId } }),
  });

  await withTimingNextHandlerMiddleware(async (_req, response) => {
    response.status(200).json({ ok: true });
  })(req, res);

  const header = res.getHeader('x-request-id');
  return typeof header === 'string' ? header : undefined;
};

describe('correlation id resolution', () => {
  it('przepuszcza poprawny nagłówek klienta', async () => {
    const provided = '3f2a1c8e-0b4d-4a11-9e77-1c2d3e4f5a6b';
    expect(await runWithRequestId(provided)).toBe(provided);
  });

  it('generuje własny id, gdy nagłówka brak', async () => {
    const generated = await runWithRequestId();
    expect(generated).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
  });

  it.each([
    ['za krótki', 'abc'],
    ['za długi', 'a'.repeat(65)],
    ['ze znakami sterującymi (CRLF-injection do logów)', 'abcdefgh\r\nx: y'],
    ['ze spacją i przecinkiem', 'chain id, forged'],
    ['pusty', ''],
  ])('odrzuca podrzucony id %s i mintuje własny', async (_label, forged) => {
    const resolved = await runWithRequestId(forged);
    expect(resolved).not.toBe(forged);
    expect(resolved).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
  });
});

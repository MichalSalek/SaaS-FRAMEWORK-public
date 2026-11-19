import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import type { IncomingHttpHeaders } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  TRUSTED_EDGE: 'cloudflare',
  TRUSTED_PROXY_DEPTH: '',
}));
vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: config }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { resolvePairRequestPlace } from './pair-request-place';

const trusted = (): IncomingHttpHeaders => ({
  host: `api.${BRAND_CONFIG.domain}`,
  'cf-ray': 'a4eb72230936512f-WAW',
  'cf-connecting-ip': '203.0.113.10',
  'cf-ipcity': 'Krak%C3%B3w',
});

beforeEach(() => {
  config.TRUSTED_EDGE = 'cloudflare';
});

describe('pair request approximate place', () => {
  it('preserves an existing GPS or legacy place even with untrusted headers', () => {
    expect(resolvePairRequestPlace('Warszawa', {})).toBe('Warszawa');
  });

  it('decodes a city from the configured trusted edge when no place is supplied', () => {
    expect(resolvePairRequestPlace(undefined, trusted())).toBe('Kraków');
    expect(resolvePairRequestPlace(' ', trusted())).toBe('Kraków');
  });

  it.each(['Kraków', 'Gdańsk', 'Łódź'])(
    'handles Node latin1 representation and already decoded UTF-8 for %s',
    city => {
      const nodeHeader = Buffer.from(city, 'utf8').toString('latin1');
      expect(
        resolvePairRequestPlace(undefined, {
          ...trusted(),
          'cf-ipcity': nodeHeader,
        })
      ).toBe(city);
      expect(
        resolvePairRequestPlace(undefined, { ...trusted(), 'cf-ipcity': city })
      ).toBe(city);
    }
  );

  it.each(['', 'vercel'])('ignores city when trusted edge is %s', edge => {
    config.TRUSTED_EDGE = edge;
    expect(resolvePairRequestPlace(undefined, trusted())).toBeUndefined();
  });

  it.each([
    { host: 'web-1.onrender.com' },
    { host: 'attacker.example' },
    { host: [`api.${BRAND_CONFIG.domain}`] },
    { 'cf-ray': undefined },
    { 'cf-ray': 'fake' },
    { 'cf-ray': ['a4eb72230936512f-WAW'] },
    { 'cf-connecting-ip': undefined },
    { 'cf-connecting-ip': 'garbage' },
    { 'cf-connecting-ip': ['203.0.113.10'] },
  ])('ignores spoofed or incomplete edge headers %#', replacement => {
    expect(
      resolvePairRequestPlace(undefined, {
        ...trusted(),
        ...replacement,
      } as unknown as IncomingHttpHeaders)
    ).toBeUndefined();
  });

  it.each([
    undefined,
    [],
    ['Paris'],
    '',
    ' ',
    'unknown',
    'undefined',
    'null',
    'n/a',
    'none',
    '%',
    '%C3',
    '%00Paris',
    'Paris%0Afoo',
    'Paris%2C%20London',
    '123',
    'a'.repeat(61),
    '%41'.repeat(61),
    '<script>',
  ])('ignores an invalid city header %#', city => {
    expect(
      resolvePairRequestPlace(undefined, { ...trusted(), 'cf-ipcity': city })
    ).toBeUndefined();
  });

  it('accepts real place punctuation and the 60 character bound', () => {
    expect(
      resolvePairRequestPlace(undefined, {
        ...trusted(),
        'cf-ipcity': 'L%27Ha%C3%BF-les-Roses',
      })
    ).toBe("L'Haÿ-les-Roses");
    expect(
      resolvePairRequestPlace(undefined, {
        ...trusted(),
        'cf-ipcity': 'a'.repeat(60),
      })
    ).toHaveLength(60);
  });
});

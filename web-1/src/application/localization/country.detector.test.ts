import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { describe, expect, it, vi } from 'vitest';
const { env } = vi.hoisted(() => ({
  env: { TRUSTED_EDGE: 'cloudflare', TRUSTED_PROXY_DEPTH: '' },
}));
vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: env }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
import { detectRequestCountry } from './country.detector';
const edge = {
  host: `api.${BRAND_CONFIG.domain}`,
  'cf-ipcountry': 'DE',
  'cf-connecting-ip': '1.1.1.1',
  'cf-ray': 'a4eb72230936512f-WAW',
};
describe('request country', () => {
  it('requires canonical host, a trusted Cloudflare edge, and a real ISO country', () => {
    env.TRUSTED_EDGE = 'cloudflare';
    expect(detectRequestCountry(edge)).toBe('DE');
    for (const value of ['XX', 'T1', 'ZZ', 'de', 'USA']) {
      expect(
        detectRequestCountry({ ...edge, 'cf-ipcountry': value })
      ).toBeNull();
    }
    expect(
      detectRequestCountry({ ...edge, host: 'raw.onrender.com' })
    ).toBeNull();
    expect(detectRequestCountry({ ...edge, 'cf-ray': 'forged' })).toBeNull();
    expect(
      detectRequestCountry({ ...edge, 'cf-connecting-ip': 'invalid' })
    ).toBeNull();
    env.TRUSTED_EDGE = '';
    expect(detectRequestCountry(edge)).toBeNull();
  });
});

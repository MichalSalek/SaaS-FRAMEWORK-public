import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  ZERO_FLASH_SCRIPT,
  ZERO_FLASH_SCRIPT_CSP_HASH,
} from './zero-flash-script';

function runPrepaintScript(search: string) {
  const attributes: Record<string, string> = {};
  const documentElement = {
    setAttribute: (key: string, value: string) => {
      attributes[key] = value;
    },
    style: {} as Record<string, unknown>,
  };
  let replacements = 0;
  runInNewContext(ZERO_FLASH_SCRIPT, {
    document: { documentElement },
    localStorage: {
      getItem: (key: string) =>
        key === 'authorization' ? 'stored-token' : null,
    },
    sessionStorage: { getItem: () => null },
    window: {
      matchMedia: () => ({ matches: false }),
      location: {
        pathname: '/',
        search,
        hash: '',
        replace: () => {
          replacements += 1;
        },
      },
    },
    URLSearchParams,
  });
  return { attributes, replacements };
}

// Drift guard: proxy.ts allows the ZERO_FLASH inline script on prod-mode (SSG)
// pages via a PINNED sha256 hash (Edge runtime can't compute it at request time).
// If ZERO_FLASH_SCRIPT changes and the pinned hash isn't updated, the inline
// theme bridge gets CSP-blocked (FOUC returns). This test fails on that drift and
// prints the correct value to paste into ZERO_FLASH_SCRIPT_CSP_HASH.
describe('ZERO_FLASH_SCRIPT CSP hash', () => {
  it('pinned hash matches sha256 of the rendered inline script', () => {
    const digest = createHash('sha256')
      .update(ZERO_FLASH_SCRIPT, 'utf8')
      .digest('base64');
    expect(ZERO_FLASH_SCRIPT_CSP_HASH).toBe(`'sha256-${digest}'`);
  });

  it('does not route a native launch based on token presence before session validation', () => {
    const { attributes, replacements } = runPrepaintScript('?platform=android');
    expect(attributes['data-theme']).toBe('rouge-papier');
    expect(attributes['data-native-startup-pending']).toBe('true');
    expect(replacements).toBe(0);
  });

  it('does not hold startup for explicit auth-code targets', () => {
    const { attributes } = runPrepaintScript(
      '?platform=android&authCode=one-time-code'
    );
    expect(attributes['data-native-startup-pending']).toBeUndefined();
  });
});

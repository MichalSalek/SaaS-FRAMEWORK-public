/**
 * Characterization tests for adminHealthValidators: pins which field is rejected and
 * __isValid, not i18n text. Reached via VALIDATION_POLICY.validators like every validator.
 * Current behavior captured as is:
 *  - adminDebugMode ignores its input and is always valid.
 *  - adminCheckAccessUrl checks only presence and string-ness, not the URL scheme, so
 *    'javascript:alert(1)' passes. Falsy url -> urlRequired; truthy non-string -> urlMustBeString.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('adminHealthValidators.adminDebugMode — setter contract (testy-api s34)', () => {
  it('accepts an explicit target state, optionally for the DB debugger', () => {
    expect(V.adminDebugMode({ enabled: true }).__isValid).toBe(true);
    expect(V.adminDebugMode({ enabled: false, debug_db: true }).__isValid).toBe(
      true
    );
  });

  it('rejects a body without a boolean `enabled` (it used to flip logging on any body)', () => {
    expect(V.adminDebugMode(undefined).__isValid).toBe(false);
    expect(V.adminDebugMode({}).__isValid).toBe(false);
    expect(V.adminDebugMode({ bogus: 1 }).__isValid).toBe(false);
    expect(V.adminDebugMode({ enabled: 'false' }).__isValid).toBe(false);
    expect(V.adminDebugMode({ enabled: true, debug_db: 'yes' }).__isValid).toBe(
      false
    );
  });
});

describe('adminHealthValidators.adminCheckAccessUrl', () => {
  it('accepts a well-formed url string', () => {
    const r = V.adminCheckAccessUrl({ url: 'https://example.com/health' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'url')).toBe(false);
  });

  it('accepts ANY truthy string url (no scheme/format gate) — characterization', () => {
    // CURRENT behavior: scheme is NOT validated here. These all PASS today; a zod
    // migration that adds an https-only gate would (correctly) flip these — that is
    // exactly the change this characterization test is meant to surface.
    for (const url of [
      'http://example.com',
      'ftp://example.com',
      'javascript:alert(1)',
      'not-a-url-at-all',
      '   leading-space',
      'https://user:pass@example.com',
    ]) {
      const r = V.adminCheckAccessUrl({ url });
      expect(r.__isValid, `url=${url}`).toBe(true);
      expect(rejected(r, 'url'), `url=${url}`).toBe(false);
    }
  });

  it('rejects a missing url (urlRequired branch) → __isValid false + url rejected', () => {
    const r = V.adminCheckAccessUrl({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'url')).toBe(true);
  });

  it('rejects falsy url values via the urlRequired (falsy) check', () => {
    for (const url of ['', undefined, null, 0, false]) {
      const r = V.adminCheckAccessUrl({ url } as { url?: string });
      expect(r.__isValid, `url=${String(url)}`).toBe(false);
      expect(rejected(r, 'url'), `url=${String(url)}`).toBe(true);
    }
  });

  it('rejects null / undefined `data` (typedData?.url is falsy → urlRequired)', () => {
    expect(V.adminCheckAccessUrl(null).__isValid).toBe(false);
    expect(rejected(V.adminCheckAccessUrl(null), 'url')).toBe(true);
    expect(V.adminCheckAccessUrl(undefined).__isValid).toBe(false);
    expect(rejected(V.adminCheckAccessUrl(undefined), 'url')).toBe(true);
  });

  it('rejects a TRUTHY non-string url (urlMustBeString branch)', () => {
    // Truthy non-strings pass `if (!url)` and hit the `else if (typeof !== "string")`.
    for (const url of [123, { nested: true }, [1, 2], ['x']]) {
      const r = V.adminCheckAccessUrl({ url } as unknown as { url?: string });
      expect(r.__isValid, `url=${JSON.stringify(url)}`).toBe(false);
      expect(rejected(r, 'url'), `url=${JSON.stringify(url)}`).toBe(true);
    }
  });

  it('rejects an empty array (truthy → non-string branch) but a non-empty string passes', () => {
    expect(
      V.adminCheckAccessUrl({ url: [] } as unknown as { url?: string })
        .__isValid
    ).toBe(false);
    expect(V.adminCheckAccessUrl({ url: 'x' }).__isValid).toBe(true);
  });
});

/**
 * Characterization tests for adminHealthValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validators as the safety net
 * the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Sibling of gallery.validation.test.ts — same shape. The admin-health validators are
 * spread into adminValidators → VALIDATION_POLICY.validators, so they are reached via
 * VALIDATION_POLICY.validators.<name> exactly like every other request validator.
 *
 * NOTE on the CURRENT behavior captured here (NOT a judgement — characterization only):
 *   - adminDebugMode IGNORES its input entirely and is ALWAYS valid (no field checks).
 *   - adminCheckAccessUrl only checks url PRESENCE + STRING-ness. It does NOT validate the
 *     URL scheme/format (no https-only gate like validateOptionalHttpsUrl), so a truthy
 *     string such as 'javascript:alert(1)' currently PASSES this validator. The first
 *     `if (!url)` is a FALSY check, so falsy url ('', undefined, null, 0, false, missing)
 *     → urlRequired; a TRUTHY non-string (123, {}, [1], non-empty array) → urlMustBeString.
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

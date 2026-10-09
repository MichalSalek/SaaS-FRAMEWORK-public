/**
 * Characterization tests for emailValidators + the validateEmail security helper
 * (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validators as the safety net
 * the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Boundary inputs (token min/max) are characterized from the LITERAL thresholds the
 * validator hardcodes (trimmed length < 20 → invalidFormat, > 500 → tooLong). These are
 * NOT sourced from VALIDATION_LENGTHS.TOKEN_* (16/64) — the email validators intentionally
 * use their own inline 20/500 caps (URL-embedded tokens, CPU-abuse guard), so the test
 * pins what the code actually does, per characterization intent.
 *
 * Follows the gallery.validation.test.ts exemplar shape.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;
const U = VALIDATION_POLICY.utils;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

// Inline token thresholds the validators hardcode (trimmed length).
const TOKEN_MIN_TRIMMED = 20;
const TOKEN_MAX_TRIMMED = 500;
const validToken = 't'.repeat(TOKEN_MIN_TRIMMED); // exactly at min boundary, accepted

// The four email validators share the identical { token } shape — run the same
// characterization matrix over each so a divergence in any one of them surfaces.
const tokenValidators = [
  ['emailUnsubscribe', V.emailUnsubscribe] as const,
  ['emailChangeConfirm', V.emailChangeConfirm] as const,
  ['deleteConfirm', V.deleteConfirm] as const,
];

describe.each(tokenValidators)(
  'emailValidators.%s (token payload)',
  (_name, validate) => {
    it('accepts a token at the min length boundary (20 chars)', () => {
      const r = validate({ token: validToken });
      expect(r.__isValid).toBe(true);
      expect(rejected(r, 'token')).toBe(false);
    });

    it('rejects a missing token', () => {
      const r = validate({});
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'token')).toBe(true);
    });

    it('rejects an empty-string token', () => {
      const r = validate({ token: '' });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'token')).toBe(true);
    });

    it('SECURITY: rejects a non-string token (number / object / array / boolean)', () => {
      for (const bad of [
        123 as unknown as string,
        {} as unknown as string,
        [] as unknown as string,
        true as unknown as string,
      ]) {
        const r = validate({ token: bad });
        expect(r.__isValid, `token=${String(bad)}`).toBe(false);
        expect(rejected(r, 'token'), `token=${String(bad)}`).toBe(true);
      }
    });

    it('rejects a token shorter than the min (trimmed length < 20)', () => {
      const r = validate({ token: 't'.repeat(TOKEN_MIN_TRIMMED - 1) });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'token')).toBe(true);
    });

    it('SECURITY: rejects an over-long token (trimmed length > 500, CPU-abuse cap)', () => {
      const r = validate({ token: 't'.repeat(TOKEN_MAX_TRIMMED + 1) });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'token')).toBe(true);
    });

    it('accepts a token at the max length boundary (500 chars)', () => {
      const r = validate({ token: 't'.repeat(TOKEN_MAX_TRIMMED) });
      expect(r.__isValid).toBe(true);
    });

    it('BOUNDARY: length is measured on the TRIMMED token (surrounding whitespace stripped)', () => {
      // 19 real chars padded to 25 with spaces → trimmed length 19 < 20 → rejected.
      const r = validate({
        token: `   ${'t'.repeat(TOKEN_MIN_TRIMMED - 1)}   `,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'token')).toBe(true);
    });

    it('BOUNDARY: a whitespace-padded valid-length token is accepted (trim makes it valid)', () => {
      // 20 real chars + padding → trimmed length 20 → accepted.
      const r = validate({ token: `  ${validToken}  ` });
      expect(r.__isValid).toBe(true);
    });
  }
);

describe('emailValidators.emailUpdatePreferences', () => {
  const valid = { trial_sequence: true, marketing: false };

  it('accepts boolean trial_sequence + marketing', () => {
    expect(V.emailUpdatePreferences({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a non-boolean trial_sequence (and flags that field)', () => {
    const r = V.emailUpdatePreferences({ ...valid, trial_sequence: 'true' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'trial_sequence')).toBe(true);
  });

  it('rejects a non-boolean marketing (and flags that field)', () => {
    const r = V.emailUpdatePreferences({ ...valid, marketing: 1 });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'marketing')).toBe(true);
  });

  it('rejects a missing trial_sequence and missing marketing', () => {
    const r = V.emailUpdatePreferences({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'trial_sequence')).toBe(true);
    expect(rejected(r, 'marketing')).toBe(true);
  });

  it('rejects null/undefined payload (treated as both fields missing)', () => {
    expect(V.emailUpdatePreferences(null).__isValid).toBe(false);
    expect(V.emailUpdatePreferences(undefined).__isValid).toBe(false);
  });

  it('CHARACTERIZATION: booleans true AND false both accepted (no truthiness coercion)', () => {
    expect(
      V.emailUpdatePreferences({ trial_sequence: false, marketing: false })
        .__isValid
    ).toBe(true);
    expect(
      V.emailUpdatePreferences({ trial_sequence: true, marketing: true })
        .__isValid
    ).toBe(true);
  });
});

describe('validateEmail (security helper)', () => {
  it('SECURITY: accepts well-formed addresses', () => {
    for (const ok of [
      'user@example.com',
      'a.b-c_d#e@sub.domain.co.uk',
      'first.last@mail.example.org',
      '1234@9.99',
    ]) {
      expect(U.validateEmail(ok), `email=${ok}`).toBe(true);
    }
  });

  it('SECURITY: rejects malformed addresses (missing @, missing dot-domain, spaces)', () => {
    for (const bad of [
      '',
      'plainaddress',
      'user@localhost', // no dot in the domain → regex requires a dotted domain
      'user@domain', // same — no TLD dot
      '@no-local.com',
      'spaces in@email.com',
      'user@@double.com',
      'user@.com',
      'trailing@dot.', // domain must have chars on both sides of the dot
    ]) {
      expect(U.validateEmail(bad), `email=${bad}`).toBe(false);
    }
  });

  it('SECURITY: rejects non-string inputs without throwing (.match type guard)', () => {
    for (const bad of [undefined, null, 123, {}, [], true, false]) {
      expect(U.validateEmail(bad as unknown), `email=${String(bad)}`).toBe(
        false
      );
    }
  });
});

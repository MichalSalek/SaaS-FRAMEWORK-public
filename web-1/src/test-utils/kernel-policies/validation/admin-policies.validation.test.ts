/**
 * Characterization tests for adminPoliciesValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel admin-policy request validators as the
 * safety net the zod migration (FAZA 2) must preserve — every assertion below is GREEN
 * against the hand-written validators, so a zod rewrite that changes a field's accept/reject
 * decision (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Validators under test (all reachable via VALIDATION_POLICY.validators, spread through
 * adminValidators → admin.validation barrel → admin-policies.validation):
 *   - adminSavePolicy   (multi-field: optional id, required title, required content)
 *   - adminDeletePolicy (validateRequiredId on `id`)
 *   - adminSetMainPolicy(validateRequiredId on `id`)
 *
 * Surprises captured below (see file-level notes), NOT "fixed":
 *   - adminSavePolicy.id accepts the EMPTY STRING ''  (only type-checked when present;
 *     '' is a string → no error), whereas validateRequiredId REJECTS '' (falsy guard).
 *   - "title"/"content" are whitespace-sensitive: '   ' (trim → empty) is rejected.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('adminPoliciesValidators.adminSavePolicy', () => {
  // Minimal valid CREATE payload: no id, title + content present and non-blank.
  const valid = { title: 'Privacy Policy', content: 'Full policy body text.' };

  it('accepts a well-formed CREATE payload (no id)', () => {
    const r = V.adminSavePolicy({ ...valid });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
    expect(rejected(r, 'title')).toBe(false);
    expect(rejected(r, 'content')).toBe(false);
  });

  it('accepts a well-formed UPDATE payload (string id present)', () => {
    const r = V.adminSavePolicy({ ...valid, id: 'policy-123' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
  });

  it('rejects a non-string id (present but wrong type) and flags the id field', () => {
    const r = V.adminSavePolicy({ ...valid, id: 123 as unknown as string });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
    // title/content still fine → only id carries the error.
    expect(rejected(r, 'title')).toBe(false);
    expect(rejected(r, 'content')).toBe(false);
  });

  it('CHARACTERIZATION: an EMPTY-STRING id is ACCEPTED (id is type-checked only, "" is a string)', () => {
    // Surprise vs validateRequiredId, which rejects ''. Here '' passes because the only
    // id guard is `typeof !== 'string'`, and typeof '' === 'string'.
    const r = V.adminSavePolicy({ ...valid, id: '' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
  });

  it('CHARACTERIZATION: id null/false/0 are treated as "absent" (undefined-or-not branch)', () => {
    // Guard is `id !== undefined && typeof id !== 'string'`. null/false/0 are !== undefined
    // AND not strings → they WOULD flag... so assert the ACTUAL behavior precisely.
    expect(
      rejected(
        V.adminSavePolicy({ ...valid, id: null as unknown as string }),
        'id'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminSavePolicy({ ...valid, id: 0 as unknown as string }),
        'id'
      )
    ).toBe(true);
    expect(
      rejected(
        V.adminSavePolicy({ ...valid, id: false as unknown as string }),
        'id'
      )
    ).toBe(true);
  });

  it('rejects a missing title and flags the title field', () => {
    const r = V.adminSavePolicy({ content: valid.content });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'title')).toBe(true);
    expect(rejected(r, 'content')).toBe(false);
  });

  it('rejects an empty-string / whitespace-only title (trim-sensitive)', () => {
    expect(rejected(V.adminSavePolicy({ ...valid, title: '' }), 'title')).toBe(
      true
    );
    expect(
      rejected(V.adminSavePolicy({ ...valid, title: '   ' }), 'title')
    ).toBe(true);
  });

  it('rejects a non-string title', () => {
    const r = V.adminSavePolicy({ ...valid, title: 42 as unknown as string });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'title')).toBe(true);
  });

  it('rejects a missing content and flags the content field', () => {
    const r = V.adminSavePolicy({ title: valid.title });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'content')).toBe(true);
    expect(rejected(r, 'title')).toBe(false);
  });

  it('rejects an empty-string / whitespace-only content (trim-sensitive)', () => {
    expect(
      rejected(V.adminSavePolicy({ ...valid, content: '' }), 'content')
    ).toBe(true);
    expect(
      rejected(V.adminSavePolicy({ ...valid, content: '\t\n  ' }), 'content')
    ).toBe(true);
  });

  it('rejects a non-string content', () => {
    const r = V.adminSavePolicy({ ...valid, content: {} as unknown as string });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'content')).toBe(true);
  });

  it('flags BOTH title and content when both are missing', () => {
    const r = V.adminSavePolicy({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'title')).toBe(true);
    expect(rejected(r, 'content')).toBe(true);
  });

  it('CHARACTERIZATION: does not throw on null/undefined payload (optional-chaining guards)', () => {
    expect(V.adminSavePolicy(null).__isValid).toBe(false);
    expect(V.adminSavePolicy(undefined).__isValid).toBe(false);
  });
});

describe('adminPoliciesValidators.adminDeletePolicy (validateRequiredId on `id`)', () => {
  it('accepts a non-empty string id', () => {
    const r = V.adminDeletePolicy({ id: 'policy-1' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
  });

  it('rejects an empty-string id (falsy guard) and flags the id field', () => {
    const r = V.adminDeletePolicy({ id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
  });

  it('rejects a missing id', () => {
    expect(V.adminDeletePolicy({}).__isValid).toBe(false);
  });

  it('rejects a non-string id', () => {
    expect(
      V.adminDeletePolicy({ id: 123 as unknown as string }).__isValid
    ).toBe(false);
    expect(
      V.adminDeletePolicy({ id: null as unknown as string }).__isValid
    ).toBe(false);
  });

  it('CHARACTERIZATION: does not throw on null/undefined payload', () => {
    expect(V.adminDeletePolicy(null).__isValid).toBe(false);
    expect(V.adminDeletePolicy(undefined).__isValid).toBe(false);
  });
});

describe('adminPoliciesValidators.adminSetMainPolicy (validateRequiredId on `id`)', () => {
  it('accepts a non-empty string id', () => {
    const r = V.adminSetMainPolicy({ id: 'policy-1' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
  });

  it('rejects an empty-string id (falsy guard) and flags the id field', () => {
    const r = V.adminSetMainPolicy({ id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
  });

  it('rejects a missing id and a non-string id', () => {
    expect(V.adminSetMainPolicy({}).__isValid).toBe(false);
    expect(V.adminSetMainPolicy({ id: 0 as unknown as string }).__isValid).toBe(
      false
    );
  });

  it('CHARACTERIZATION: does not throw on null/undefined payload', () => {
    expect(V.adminSetMainPolicy(null).__isValid).toBe(false);
    expect(V.adminSetMainPolicy(undefined).__isValid).toBe(false);
  });
});

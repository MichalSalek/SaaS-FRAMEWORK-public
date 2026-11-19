/**
 * Characterization tests for adminFeatureFlagsValidators: pins which field is rejected
 * and __isValid, not i18n text (a rejected field has a non-empty error string).
 * The validator is reached through VALIDATION_POLICY.validators, the same handle the route
 * uses (pages/api/v1/admin/feature-flags/toggle), so the production access path is covered.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('adminFeatureFlagsValidators.adminToggleFeatureFlag', () => {
  // Valid payload per ADMIN_DTO_API_V1['ADMIN_TOGGLE_FEATURE_FLAG']['REQUEST']:
  // { key: string; is_enabled: boolean }. key is validated only as a non-empty
  // string (NOT against FEATURE_FLAG_KEYS SSOT — see DECISION comment in the validator).
  const valid = { key: 'SOME_FLAG', is_enabled: true };

  it('accepts a well-formed payload (non-empty string key + boolean is_enabled=true)', () => {
    const r = V.adminToggleFeatureFlag({ ...valid });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'key')).toBe(false);
    expect(rejected(r, 'is_enabled')).toBe(false);
  });

  it('accepts is_enabled=false (both boolean values are valid, not just true)', () => {
    const r = V.adminToggleFeatureFlag({ ...valid, is_enabled: false });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'is_enabled')).toBe(false);
  });

  it('accepts an arbitrary non-empty string key (key NOT checked against the FEATURE_FLAG_KEYS allowlist)', () => {
    // DECISION in the validator: unknown keys pass validation and are handled
    // graceful at the operation layer (findUnique → ADMIN_TARGET_NOT_FOUND → 404).
    const r = V.adminToggleFeatureFlag({
      key: 'totally-unknown-flag-xyz',
      is_enabled: true,
    });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'key')).toBe(false);
  });

  it('rejects an empty-string key (falsy → key error set)', () => {
    const r = V.adminToggleFeatureFlag({ ...valid, key: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'key')).toBe(true);
    // is_enabled was valid, so only key carries the error.
    expect(rejected(r, 'is_enabled')).toBe(false);
  });

  it('rejects a missing key (undefined → key error set)', () => {
    const r = V.adminToggleFeatureFlag({ is_enabled: true } as unknown as {
      key: string;
      is_enabled: boolean;
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'key')).toBe(true);
  });

  it('SECURITY: rejects a non-string key (number / boolean / object / array all fail the string guard)', () => {
    for (const badKey of [
      123 as unknown as string,
      true as unknown as string,
      {} as unknown as string,
      ['x'] as unknown as string,
    ]) {
      const r = V.adminToggleFeatureFlag({ key: badKey, is_enabled: true });
      expect(r.__isValid, `key=${JSON.stringify(badKey)}`).toBe(false);
      expect(rejected(r, 'key'), `key=${JSON.stringify(badKey)}`).toBe(true);
    }
  });

  it('rejects a missing is_enabled (undefined is not boolean → is_enabled error set)', () => {
    const r = V.adminToggleFeatureFlag({ key: 'SOME_FLAG' } as unknown as {
      key: string;
      is_enabled: boolean;
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'is_enabled')).toBe(true);
    expect(rejected(r, 'key')).toBe(false);
  });

  it('rejects a non-boolean is_enabled (string "true" / number 1 / null all fail the typeof boolean guard)', () => {
    for (const badEnabled of [
      'true' as unknown as boolean,
      1 as unknown as boolean,
      0 as unknown as boolean,
      null as unknown as boolean,
    ]) {
      const r = V.adminToggleFeatureFlag({
        key: 'SOME_FLAG',
        is_enabled: badEnabled,
      });
      expect(r.__isValid, `is_enabled=${JSON.stringify(badEnabled)}`).toBe(
        false
      );
      expect(
        rejected(r, 'is_enabled'),
        `is_enabled=${JSON.stringify(badEnabled)}`
      ).toBe(true);
    }
  });

  it('rejects with BOTH field errors when both key and is_enabled are invalid', () => {
    const r = V.adminToggleFeatureFlag({
      key: '',
      is_enabled: 'nope' as unknown as boolean,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'key')).toBe(true);
    expect(rejected(r, 'is_enabled')).toBe(true);
  });

  it('EDGE: rejects a null / undefined payload (optional-chaining → both fields error, no throw)', () => {
    for (const bad of [null, undefined]) {
      const r = V.adminToggleFeatureFlag(bad);
      expect(r.__isValid, `data=${String(bad)}`).toBe(false);
      expect(rejected(r, 'key'), `data=${String(bad)}`).toBe(true);
      expect(rejected(r, 'is_enabled'), `data=${String(bad)}`).toBe(true);
    }
  });

  it('EDGE: accepts a numeric-looking but truthy string key like "0" (string + non-empty)', () => {
    // '0' is a non-empty string → passes !typedData.key (truthy) + typeof string.
    const r = V.adminToggleFeatureFlag({ key: '0', is_enabled: false });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'key')).toBe(false);
  });
});

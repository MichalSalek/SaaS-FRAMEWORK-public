/**
 * Characterization tests for adminReportsValidators: pins which field is rejected and
 * __isValid, not i18n text. Boundaries are derived from REPORT_PERIODS, so adding or removing
 * a period in the config moves the tests in lockstep.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { REPORT_PERIODS } from '@kernel/domain/admin/admin.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('adminReportsValidators.adminGetReports', () => {
  // Every period in the SSOT config must validate — derived, not hardcoded.
  it.each(REPORT_PERIODS as readonly string[])(
    'accepts a valid period "%s" from REPORT_PERIODS',
    period => {
      const r = V.adminGetReports({ period });
      expect(r.__isValid).toBe(true);
      expect(rejected(r, 'period')).toBe(false);
    }
  );

  it('rejects a missing period (period field carries the error)', () => {
    const r = V.adminGetReports({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'period')).toBe(true);
  });

  it('rejects an empty-string period (falsy → periodRequired branch)', () => {
    const r = V.adminGetReports({ period: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'period')).toBe(true);
  });

  it('rejects an out-of-enum period (present but not in REPORT_PERIODS)', () => {
    for (const bad of ['year', 'day', 'WEEK', 'Month', 'all', 'weekly']) {
      const r = V.adminGetReports({ period: bad });
      expect(r.__isValid, `period=${bad}`).toBe(false);
      expect(rejected(r, 'period'), `period=${bad}`).toBe(true);
    }
  });

  // CHARACTERIZED SURPRISE: the validator only ever falsy-checks `typedData?.period`,
  // so a fully missing payload (null / undefined) takes the `!typedData?.period`
  // branch and rejects on `period` WITHOUT throwing — no type guard on the wrapper.
  it('rejects null / undefined data without throwing', () => {
    for (const bad of [null, undefined]) {
      const r = V.adminGetReports(bad);
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'period')).toBe(true);
    }
  });

  // CHARACTERIZED SURPRISE: `period` is treated as `unknown` then membership-checked
  // against a `readonly string[]` cast. A truthy non-string (number / boolean / object)
  // is NOT in the string enum, so it falls into the `periodInvalid` branch and rejects.
  it('rejects a truthy non-string period (number / boolean / object)', () => {
    for (const bad of [1, true, {}, ['week']]) {
      const r = V.adminGetReports({ period: bad as unknown as string });
      expect(r.__isValid, `period=${String(bad)}`).toBe(false);
      expect(rejected(r, 'period'), `period=${String(bad)}`).toBe(true);
    }
  });

  // CHARACTERIZED: extra unknown keys are ignored — only `period` is inspected, and
  // the return object exposes only `__isValid`, `__general`, `period`. Surplus input
  // does not flip validity (no strict/unknown-key rejection, unlike a zod `.strict()`).
  it('ignores extra unknown keys alongside a valid period', () => {
    const r = V.adminGetReports({
      period: REPORT_PERIODS[0],
      injected: 'ignored',
      __isValid: true,
    } as unknown);
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'period')).toBe(false);
  });
});

/**
 * Characterization tests for moderationValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel moderation request validators as the
 * safety net the zod migration (FAZA 2) must preserve — every assertion below is GREEN
 * against the hand-written validators, so a zod rewrite that changes a field's
 * accept/reject decision (or which field carries the error) flips a test. They assert
 * the validation LOGIC (which field is rejected, __isValid), NOT exact i18n message text
 * (brittle): a rejected field is asserted via a non-empty error string.
 *
 * Boundary inputs are DERIVED from the SSOT configs (VALIDATION_MODERATION) and the
 * domain enums (CONTENT_REPORT_REASONS, MODERATION_ACTIONS), not hardcoded, so a limit
 * change in the config moves these in lockstep.
 *
 * Sibling of gallery.validation.test.ts (same shape).
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import {
  CONTENT_REPORT_REASONS,
  MODERATION_ACTIONS,
} from '@kernel/models/moderation/moderation.dto';
import { VALIDATION_MODERATION } from '@kernel/policies/validation.config';

const V = VALIDATION_POLICY.validators;

// A valid reason / action derived from the SSOT enums (first member).
const SOME_REASON = CONTENT_REPORT_REASONS[0] as string;
const SOME_ACTION = MODERATION_ACTIONS[0] as string;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('moderationValidators.reportGalleryRecord', () => {
  const valid = {
    gallery_record_id: 'gr-1',
    reason: SOME_REASON,
  };

  it('accepts a well-formed report (no description)', () => {
    expect(V.reportGalleryRecord({ ...valid }).__isValid).toBe(true);
  });

  it('accepts a well-formed report WITH a description', () => {
    expect(
      V.reportGalleryRecord({
        ...valid,
        description: 'This image is not appropriate.',
      }).__isValid
    ).toBe(true);
  });

  it('SECURITY: requires a string gallery_record_id', () => {
    const empty = V.reportGalleryRecord({ ...valid, gallery_record_id: '' });
    expect(empty.__isValid).toBe(false);
    expect(rejected(empty, 'gallery_record_id')).toBe(true);

    const nonString = V.reportGalleryRecord({
      ...valid,
      gallery_record_id: 123 as unknown as string,
    });
    expect(nonString.__isValid).toBe(false);
    expect(rejected(nonString, 'gallery_record_id')).toBe(true);
  });

  it('SECURITY: requires a reason', () => {
    const missing = V.reportGalleryRecord({
      gallery_record_id: 'gr-1',
      reason: '' as unknown as string,
    });
    expect(missing.__isValid).toBe(false);
    expect(rejected(missing, 'reason')).toBe(true);

    const nonString = V.reportGalleryRecord({
      gallery_record_id: 'gr-1',
      reason: 5 as unknown as string,
    });
    expect(nonString.__isValid).toBe(false);
    expect(rejected(nonString, 'reason')).toBe(true);
  });

  it('SECURITY: rejects a reason not in CONTENT_REPORT_REASONS (allowlist, not free text)', () => {
    for (const bad of ['NOT_A_REASON', 'inappropriate', 'spam', '<script>']) {
      const r = V.reportGalleryRecord({ ...valid, reason: bad });
      expect(r.__isValid, `reason=${bad}`).toBe(false);
      expect(rejected(r, 'reason'), `reason=${bad}`).toBe(true);
    }
  });

  it('accepts EVERY canonical reason from the SSOT enum', () => {
    for (const reason of CONTENT_REPORT_REASONS) {
      const r = V.reportGalleryRecord({ ...valid, reason: reason as string });
      expect(r.__isValid, `reason=${reason}`).toBe(true);
    }
  });

  it('rejects a description over DESCRIPTION_MAX, accepts one at the boundary', () => {
    const tooLong = 'x'.repeat(VALIDATION_MODERATION.DESCRIPTION_MAX + 1);
    const over = V.reportGalleryRecord({ ...valid, description: tooLong });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'description')).toBe(true);

    const atMax = 'x'.repeat(VALIDATION_MODERATION.DESCRIPTION_MAX);
    expect(
      V.reportGalleryRecord({ ...valid, description: atMax }).__isValid
    ).toBe(true);
  });

  it('CHARACTERIZATION: DESCRIPTION_MIN is NOT enforced — a short / empty description passes', () => {
    // The validator only checks the MAX bound; '' and a 1-char description are accepted
    // even though VALIDATION_MODERATION.DESCRIPTION_MIN === 10. Locking the actual
    // behavior: a zod migration that starts enforcing the min would flip this.
    expect(V.reportGalleryRecord({ ...valid, description: '' }).__isValid).toBe(
      true
    );
    expect(
      V.reportGalleryRecord({ ...valid, description: 'x' }).__isValid
    ).toBe(true);
  });

  it('rejects a non-string description', () => {
    const r = V.reportGalleryRecord({
      ...valid,
      description: 42 as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'description')).toBe(true);
  });

  it('CHARACTERIZATION: null description is treated as absent (accepted)', () => {
    expect(
      V.reportGalleryRecord({
        ...valid,
        description: null as unknown as string,
      }).__isValid
    ).toBe(true);
  });

  it('rejects null/undefined payload entirely (missing required fields)', () => {
    expect(V.reportGalleryRecord(null).__isValid).toBe(false);
    expect(V.reportGalleryRecord(undefined).__isValid).toBe(false);
  });
});

describe('moderationValidators.adminResolveReport', () => {
  const valid = {
    report_id: 'rep-1',
    action: SOME_ACTION,
  };

  it('accepts a well-formed resolve (no admin_note)', () => {
    expect(V.adminResolveReport({ ...valid }).__isValid).toBe(true);
  });

  it('SECURITY: requires a string report_id', () => {
    const empty = V.adminResolveReport({ ...valid, report_id: '' });
    expect(empty.__isValid).toBe(false);
    expect(rejected(empty, 'report_id')).toBe(true);

    const nonString = V.adminResolveReport({
      ...valid,
      report_id: {} as unknown as string,
    });
    expect(nonString.__isValid).toBe(false);
    expect(rejected(nonString, 'report_id')).toBe(true);
  });

  it('SECURITY: requires an action', () => {
    const missing = V.adminResolveReport({
      report_id: 'rep-1',
      action: '' as unknown as string,
    });
    expect(missing.__isValid).toBe(false);
    expect(rejected(missing, 'action')).toBe(true);
  });

  it('SECURITY: rejects an action not in MODERATION_ACTIONS (allowlist)', () => {
    for (const bad of ['NUKE', 'warn', 'delete', 'PROMOTE']) {
      const r = V.adminResolveReport({ ...valid, action: bad });
      expect(r.__isValid, `action=${bad}`).toBe(false);
      expect(rejected(r, 'action'), `action=${bad}`).toBe(true);
    }
  });

  it('accepts EVERY canonical action from the SSOT enum', () => {
    for (const action of MODERATION_ACTIONS) {
      const r = V.adminResolveReport({ ...valid, action: action as string });
      expect(r.__isValid, `action=${action}`).toBe(true);
    }
  });

  it('rejects an admin_note over ADMIN_NOTE_MAX, accepts one at the boundary', () => {
    const tooLong = 'x'.repeat(VALIDATION_MODERATION.ADMIN_NOTE_MAX + 1);
    const over = V.adminResolveReport({ ...valid, admin_note: tooLong });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'admin_note')).toBe(true);

    const atMax = 'x'.repeat(VALIDATION_MODERATION.ADMIN_NOTE_MAX);
    expect(
      V.adminResolveReport({ ...valid, admin_note: atMax }).__isValid
    ).toBe(true);
  });

  it('rejects a non-string admin_note but accepts null/undefined (optional)', () => {
    expect(
      V.adminResolveReport({ ...valid, admin_note: 1 as unknown as string })
        .__isValid
    ).toBe(false);
    expect(
      V.adminResolveReport({ ...valid, admin_note: null as unknown as string })
        .__isValid
    ).toBe(true);
    expect(
      V.adminResolveReport({ ...valid, admin_note: undefined }).__isValid
    ).toBe(true);
  });
});

describe('moderationValidators.adminApplyStrike', () => {
  const valid = {
    user_id: 'usr-1',
    reason: 'Repeated inappropriate uploads.',
  };

  it('accepts a well-formed strike (no report_id)', () => {
    expect(V.adminApplyStrike({ ...valid }).__isValid).toBe(true);
  });

  it('SECURITY: requires a string user_id', () => {
    const empty = V.adminApplyStrike({ ...valid, user_id: '' });
    expect(empty.__isValid).toBe(false);
    expect(rejected(empty, 'user_id')).toBe(true);

    const nonString = V.adminApplyStrike({
      ...valid,
      user_id: 0 as unknown as string,
    });
    expect(nonString.__isValid).toBe(false);
    expect(rejected(nonString, 'user_id')).toBe(true);
  });

  it('requires a non-empty string reason', () => {
    const empty = V.adminApplyStrike({ ...valid, reason: '' });
    expect(empty.__isValid).toBe(false);
    expect(rejected(empty, 'reason')).toBe(true);

    const nonString = V.adminApplyStrike({
      ...valid,
      reason: true as unknown as string,
    });
    expect(nonString.__isValid).toBe(false);
    expect(rejected(nonString, 'reason')).toBe(true);
  });

  it('rejects a reason over STRIKE_REASON_MAX, accepts one at the boundary', () => {
    const tooLong = 'x'.repeat(VALIDATION_MODERATION.STRIKE_REASON_MAX + 1);
    const over = V.adminApplyStrike({ ...valid, reason: tooLong });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'reason')).toBe(true);

    const atMax = 'x'.repeat(VALIDATION_MODERATION.STRIKE_REASON_MAX);
    expect(V.adminApplyStrike({ ...valid, reason: atMax }).__isValid).toBe(
      true
    );
  });

  it('report_id is optional: omitted / undefined are valid', () => {
    expect(V.adminApplyStrike({ ...valid }).__isValid).toBe(true);
    expect(
      V.adminApplyStrike({ ...valid, report_id: undefined }).__isValid
    ).toBe(true);
  });

  it('accepts a string report_id when provided', () => {
    expect(V.adminApplyStrike({ ...valid, report_id: 'rep-9' }).__isValid).toBe(
      true
    );
  });

  it('CHARACTERIZATION: report_id present-but-non-string is rejected; empty string passes', () => {
    // The guard is `report_id !== undefined && typeof !== 'string'` — so a non-string
    // value is rejected, but '' is a string and therefore accepted (no falsy check,
    // unlike the required-id fields). Locking the actual asymmetry.
    const nonString = V.adminApplyStrike({
      ...valid,
      report_id: 7 as unknown as string,
    });
    expect(nonString.__isValid).toBe(false);
    expect(rejected(nonString, 'report_id')).toBe(true);

    // null !== undefined AND typeof null !== 'string' → rejected.
    const asNull = V.adminApplyStrike({
      ...valid,
      report_id: null as unknown as string,
    });
    expect(asNull.__isValid).toBe(false);
    expect(rejected(asNull, 'report_id')).toBe(true);

    // empty string IS a string → passes the optional-field guard.
    expect(V.adminApplyStrike({ ...valid, report_id: '' }).__isValid).toBe(
      true
    );
  });

  it('rejects null/undefined payload entirely', () => {
    expect(V.adminApplyStrike(null).__isValid).toBe(false);
    expect(V.adminApplyStrike(undefined).__isValid).toBe(false);
  });
});

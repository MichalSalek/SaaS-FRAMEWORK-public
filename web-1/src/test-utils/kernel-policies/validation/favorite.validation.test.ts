/**
 * Characterization tests for favoriteValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel favorite request validators as the
 * safety net the zod migration (FAZA 2) must preserve — every assertion below is GREEN
 * against the hand-written validators, so a zod rewrite that changes a field's
 * accept/reject decision (or which field carries the error) flips a test. They assert
 * the validation LOGIC (which field is rejected, __isValid), NOT exact i18n message
 * text (brittle) — a rejected field is asserted via a non-empty error string.
 *
 * Boundary inputs (note length) are DERIVED from the SSOT config (VALIDATION_LENGTHS),
 * not hardcoded, so a NOTE_MAX change in the config moves these in lockstep.
 *
 * Sibling of gallery.validation.test.ts — same shape.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const NOTE_MAX = VALIDATION_LENGTHS.NOTE_MAX;
const NOTE_AT_MAX = 'x'.repeat(NOTE_MAX);
const NOTE_OVER_MAX = 'x'.repeat(NOTE_MAX + 1);

describe('favoriteValidators.bookmarkStylist', () => {
  it('accepts a non-empty string stylist_account_id', () => {
    expect(V.bookmarkStylist({ stylist_account_id: 'sa-1' }).__isValid).toBe(
      true
    );
  });

  it('rejects an empty stylist_account_id', () => {
    const r = V.bookmarkStylist({ stylist_account_id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'stylist_account_id')).toBe(true);
  });

  it('SECURITY: rejects a missing / non-string stylist_account_id', () => {
    for (const bad of [
      undefined,
      null,
      123 as unknown as string,
      { id: 'x' } as unknown as string,
      ['sa-1'] as unknown as string,
    ]) {
      const r = V.bookmarkStylist({
        stylist_account_id: bad as unknown as string,
      });
      expect(r.__isValid, `stylist_account_id=${String(bad)}`).toBe(false);
      expect(
        rejected(r, 'stylist_account_id'),
        `stylist_account_id=${String(bad)}`
      ).toBe(true);
    }
  });
});

describe('favoriteValidators.unbookmarkStylist', () => {
  it('accepts a non-empty string stylist_account_id', () => {
    expect(V.unbookmarkStylist({ stylist_account_id: 'sa-1' }).__isValid).toBe(
      true
    );
  });

  it('rejects an empty / non-string stylist_account_id', () => {
    expect(
      rejected(
        V.unbookmarkStylist({ stylist_account_id: '' }),
        'stylist_account_id'
      )
    ).toBe(true);
    expect(
      V.unbookmarkStylist({ stylist_account_id: 99 as unknown as string })
        .__isValid
    ).toBe(false);
  });
});

describe('favoriteValidators.favoriteAddRecord', () => {
  const valid = { gallery_record_id: 'g1' };

  it('accepts a record with only gallery_record_id (note omitted)', () => {
    expect(V.favoriteAddRecord({ ...valid }).__isValid).toBe(true);
  });

  it('accepts a valid string note', () => {
    expect(
      V.favoriteAddRecord({ ...valid, note: 'love this set' }).__isValid
    ).toBe(true);
  });

  it('accepts note === null and note === undefined (optional)', () => {
    expect(V.favoriteAddRecord({ ...valid, note: null }).__isValid).toBe(true);
    expect(V.favoriteAddRecord({ ...valid, note: undefined }).__isValid).toBe(
      true
    );
  });

  it('rejects a missing / empty gallery_record_id', () => {
    const r = V.favoriteAddRecord({ gallery_record_id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'gallery_record_id')).toBe(true);
  });

  it('rejects a non-string gallery_record_id', () => {
    const r = V.favoriteAddRecord({
      gallery_record_id: 5 as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'gallery_record_id')).toBe(true);
  });

  it('rejects a non-string note (when provided)', () => {
    const r = V.favoriteAddRecord({ ...valid, note: 123 as unknown as string });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'note')).toBe(true);
  });

  it('BOUNDARY: accepts a note exactly NOTE_MAX, rejects NOTE_MAX + 1', () => {
    expect(V.favoriteAddRecord({ ...valid, note: NOTE_AT_MAX }).__isValid).toBe(
      true
    );
    const over = V.favoriteAddRecord({ ...valid, note: NOTE_OVER_MAX });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'note')).toBe(true);
  });

  it('CHARACTERIZATION: empty-string note is accepted (falsy passes the null/undefined guard but is a string within length)', () => {
    // note='' is !== null && !== undefined → typeof check passes (string) → length 0 <= max → no error.
    expect(V.favoriteAddRecord({ ...valid, note: '' }).__isValid).toBe(true);
  });
});

describe('favoriteValidators.favoriteRemoveRecord', () => {
  it('requires a non-empty string gallery_record_id', () => {
    expect(V.favoriteRemoveRecord({ gallery_record_id: 'g1' }).__isValid).toBe(
      true
    );
    expect(V.favoriteRemoveRecord({ gallery_record_id: '' }).__isValid).toBe(
      false
    );
    expect(
      V.favoriteRemoveRecord({ gallery_record_id: 7 as unknown as string })
        .__isValid
    ).toBe(false);
  });

  it('carries the error on the gallery_record_id field', () => {
    expect(
      rejected(
        V.favoriteRemoveRecord({ gallery_record_id: '' }),
        'gallery_record_id'
      )
    ).toBe(true);
  });
});

describe('favoriteValidators.favoriteUpdateRecordNote', () => {
  const valid = { gallery_record_id: 'g1', note: 'updated note' };

  it('accepts a valid id + string note', () => {
    expect(V.favoriteUpdateRecordNote({ ...valid }).__isValid).toBe(true);
  });

  it('accepts note === null (clear) and note === undefined', () => {
    expect(
      V.favoriteUpdateRecordNote({ gallery_record_id: 'g1', note: null })
        .__isValid
    ).toBe(true);
    expect(
      V.favoriteUpdateRecordNote({
        gallery_record_id: 'g1',
        note: undefined as unknown as null,
      }).__isValid
    ).toBe(true);
  });

  it('rejects a missing / empty / non-string gallery_record_id', () => {
    expect(
      rejected(
        V.favoriteUpdateRecordNote({ gallery_record_id: '', note: null }),
        'gallery_record_id'
      )
    ).toBe(true);
    expect(
      V.favoriteUpdateRecordNote({
        gallery_record_id: 1 as unknown as string,
        note: null,
      }).__isValid
    ).toBe(false);
  });

  it('rejects a non-string note (when provided)', () => {
    const r = V.favoriteUpdateRecordNote({
      gallery_record_id: 'g1',
      note: { x: 1 } as unknown as string,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'note')).toBe(true);
  });

  it('BOUNDARY: accepts a note exactly NOTE_MAX, rejects NOTE_MAX + 1', () => {
    expect(
      V.favoriteUpdateRecordNote({ gallery_record_id: 'g1', note: NOTE_AT_MAX })
        .__isValid
    ).toBe(true);
    const over = V.favoriteUpdateRecordNote({
      gallery_record_id: 'g1',
      note: NOTE_OVER_MAX,
    });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'note')).toBe(true);
  });

  it('rejects when BOTH id and note are invalid (multi-field error)', () => {
    const r = V.favoriteUpdateRecordNote({
      gallery_record_id: '',
      note: NOTE_OVER_MAX,
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'gallery_record_id')).toBe(true);
    expect(rejected(r, 'note')).toBe(true);
  });
});

describe('favoriteValidators — no-op read validators (always valid)', () => {
  it('getBookmarkedStylists is always valid, ignoring input', () => {
    expect(V.getBookmarkedStylists(undefined).__isValid).toBe(true);
    expect(V.getBookmarkedStylists({ anything: 'goes' }).__isValid).toBe(true);
    expect(V.getBookmarkedStylists({ take: -999, cursor: '' }).__isValid).toBe(
      true
    );
  });

  it('favoriteGetRecords is always valid, ignoring input', () => {
    expect(V.favoriteGetRecords(undefined).__isValid).toBe(true);
    expect(V.favoriteGetRecords({ junk: true }).__isValid).toBe(true);
  });

  it('favoriteGetGrouped is always valid, ignoring input', () => {
    expect(V.favoriteGetGrouped(undefined).__isValid).toBe(true);
    expect(V.favoriteGetGrouped({ junk: true }).__isValid).toBe(true);
  });
});

/**
 * Characterization tests for galleryValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validators as the safety net
 * the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (NAIL_LENGTHS, VALIDATION_GALLERY,
 * VALIDATION_PAGINATION), not hardcoded, so a limit change in the config moves these in lockstep.
 *
 * EXEMPLAR for the FAZA 1 fan-out — sibling *.validation.test.ts files follow this shape.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import {
  VALIDATION_GALLERY,
  VALIDATION_PAGINATION,
} from '@kernel/policies/validation.config';

const V = VALIDATION_POLICY.validators;
const SOME_NAIL_LENGTH = Object.values(NAIL_LENGTHS)[0] as string;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('galleryValidators.createGalleryRecord', () => {
  const valid = {
    asset_url: 'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/nail.jpg',
    color_ids: ['color-1'],
    trait_ids: ['trait-1'],
    nail_length: SOME_NAIL_LENGTH,
  };

  it('accepts a well-formed record', () => {
    const r = V.createGalleryRecord({ ...valid });
    expect(r.__isValid).toBe(true);
  });

  it('rejects a missing asset_url', () => {
    const r = V.createGalleryRecord({ ...valid, asset_url: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'asset_url')).toBe(true);
  });

  it('SECURITY: rejects a non-cloudinary asset_url (only https://res.cloudinary.com/ allowed)', () => {
    for (const bad of [
      'https://evil.example.com/x.jpg',
      'http://res.cloudinary.com/x.jpg',
      'https://res.cloudinary.com.evil.com/x.jpg',
      'javascript:alert(1)',
    ]) {
      const r = V.createGalleryRecord({ ...valid, asset_url: bad });
      expect(r.__isValid, `asset_url=${bad}`).toBe(false);
      expect(rejected(r, 'asset_url'), `asset_url=${bad}`).toBe(true);
    }
  });

  it('rejects empty trait_ids and empty color_ids', () => {
    expect(V.createGalleryRecord({ ...valid, trait_ids: [] }).__isValid).toBe(
      false
    );
    expect(V.createGalleryRecord({ ...valid, color_ids: [] }).__isValid).toBe(
      false
    );
  });

  it('rejects too many trait_ids / color_ids (over the configured max)', () => {
    const tooManyTraits = Array.from(
      { length: VALIDATION_GALLERY.MAX_TRAIT_IDS + 1 },
      (_, i) => `t${i}`
    );
    const tooManyColors = Array.from(
      { length: VALIDATION_GALLERY.MAX_COLOR_IDS + 1 },
      (_, i) => `c${i}`
    );
    expect(
      rejected(
        V.createGalleryRecord({ ...valid, trait_ids: tooManyTraits }),
        'trait_ids'
      )
    ).toBe(true);
    expect(
      rejected(
        V.createGalleryRecord({ ...valid, color_ids: tooManyColors }),
        'color_ids'
      )
    ).toBe(true);
  });

  it('rejects non-string ids inside trait_ids / color_ids', () => {
    expect(
      V.createGalleryRecord({ ...valid, trait_ids: [123 as unknown as string] })
        .__isValid
    ).toBe(false);
    expect(V.createGalleryRecord({ ...valid, color_ids: [''] }).__isValid).toBe(
      false
    );
  });

  it('rejects an invalid nail_length not in NAIL_LENGTHS', () => {
    const r = V.createGalleryRecord({ ...valid, nail_length: 'NOT_A_LENGTH' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'nail_length')).toBe(true);
  });
});

describe('galleryValidators.getGalleryRecords', () => {
  const valid = { color_ids: [], trait_ids: [], apply_strict_filter: false };

  it('accepts arrays for color_ids/trait_ids', () => {
    expect(V.getGalleryRecords({ ...valid }).__isValid).toBe(true);
  });

  it('rejects non-array color_ids / trait_ids', () => {
    expect(V.getGalleryRecords({ ...valid, color_ids: 'x' }).__isValid).toBe(
      false
    );
    expect(V.getGalleryRecords({ ...valid, trait_ids: 'x' }).__isValid).toBe(
      false
    );
  });

  it('rejects take below min / above max, accepts in-range', () => {
    expect(
      V.getGalleryRecords({
        ...valid,
        take: VALIDATION_PAGINATION.LIMIT_MIN - 1,
      }).__isValid
    ).toBe(false);
    expect(
      V.getGalleryRecords({
        ...valid,
        take: VALIDATION_PAGINATION.LIMIT_MAX + 1,
      }).__isValid
    ).toBe(false);
    expect(
      V.getGalleryRecords({ ...valid, take: VALIDATION_PAGINATION.LIMIT_MIN })
        .__isValid
    ).toBe(true);
  });

  it('rejects an empty-string cursor when provided', () => {
    expect(V.getGalleryRecords({ ...valid, cursor: '' }).__isValid).toBe(false);
    expect(V.getGalleryRecords({ ...valid, cursor: 'abc' }).__isValid).toBe(
      true
    );
  });
});

describe('galleryValidators.deleteAssetFromVendor', () => {
  it('requires asset_id', () => {
    expect(V.deleteAssetFromVendor({ asset_id: 'a1' }).__isValid).toBe(true);
    expect(V.deleteAssetFromVendor({ asset_id: '' }).__isValid).toBe(false);
  });
});

describe('galleryValidators.updateGalleryRecord (partial update)', () => {
  it('requires a string gallery_record_id', () => {
    expect(V.updateGalleryRecord({ gallery_record_id: 'g1' }).__isValid).toBe(
      true
    );
    expect(V.updateGalleryRecord({ gallery_record_id: '' }).__isValid).toBe(
      false
    );
  });

  it('PARTIAL: omitted optional fields are NOT validated', () => {
    // Only id present, no trait_ids/color_ids/nail_length → valid (partial update).
    expect(V.updateGalleryRecord({ gallery_record_id: 'g1' }).__isValid).toBe(
      true
    );
  });

  it('PARTIAL: a PROVIDED optional field IS validated', () => {
    expect(
      V.updateGalleryRecord({ gallery_record_id: 'g1', trait_ids: [] })
        .__isValid
    ).toBe(false);
    expect(
      V.updateGalleryRecord({ gallery_record_id: 'g1', nail_length: 'NOPE' })
        .__isValid
    ).toBe(false);
    expect(
      V.updateGalleryRecord({
        gallery_record_id: 'g1',
        nail_length: SOME_NAIL_LENGTH,
      }).__isValid
    ).toBe(true);
  });
});

describe('galleryValidators.deleteGalleryRecord / getGalleryRecordById', () => {
  it('require a string gallery_record_id', () => {
    expect(V.deleteGalleryRecord({ gallery_record_id: 'g1' }).__isValid).toBe(
      true
    );
    expect(V.deleteGalleryRecord({ gallery_record_id: '' }).__isValid).toBe(
      false
    );
    expect(V.getGalleryRecordById({ gallery_record_id: 'g1' }).__isValid).toBe(
      true
    );
    expect(V.getGalleryRecordById({ gallery_record_id: '' }).__isValid).toBe(
      false
    );
  });
});

describe('galleryValidators.publicGetGalleryRecordsByAccount', () => {
  const valid = { account_id: 'acc-1' };

  it('requires account_id', () => {
    expect(V.publicGetGalleryRecordsByAccount({ ...valid }).__isValid).toBe(
      true
    );
    expect(
      V.publicGetGalleryRecordsByAccount({ account_id: '' }).__isValid
    ).toBe(false);
  });

  it('validates limit/offset bounds when provided', () => {
    expect(
      V.publicGetGalleryRecordsByAccount({
        ...valid,
        limit: VALIDATION_PAGINATION.LIMIT_MAX + 1,
      }).__isValid
    ).toBe(false);
    expect(
      V.publicGetGalleryRecordsByAccount({
        ...valid,
        offset: VALIDATION_PAGINATION.OFFSET_MIN - 1,
      }).__isValid
    ).toBe(false);
  });

  it('rejects non-array color_ids / trait_ids when provided', () => {
    expect(
      V.publicGetGalleryRecordsByAccount({ ...valid, color_ids: 'x' }).__isValid
    ).toBe(false);
    expect(
      V.publicGetGalleryRecordsByAccount({ ...valid, trait_ids: 'x' }).__isValid
    ).toBe(false);
  });
});

describe('galleryValidators.galleryGetForPairedClient', () => {
  const valid = { stylist_account_id: 'sa-1' };

  it('requires stylist_account_id', () => {
    expect(V.galleryGetForPairedClient({ ...valid }).__isValid).toBe(true);
    expect(
      V.galleryGetForPairedClient({ stylist_account_id: '' }).__isValid
    ).toBe(false);
  });

  it('validates limit/offset bounds when provided', () => {
    expect(
      V.galleryGetForPairedClient({
        ...valid,
        limit: VALIDATION_PAGINATION.LIMIT_MAX + 1,
      }).__isValid
    ).toBe(false);
    expect(
      V.galleryGetForPairedClient({
        ...valid,
        offset: VALIDATION_PAGINATION.OFFSET_MIN - 1,
      }).__isValid
    ).toBe(false);
  });
});

describe('galleryValidators.exploreGalleryRecords', () => {
  it('accepts an empty filter object', () => {
    expect(V.exploreGalleryRecords({}).__isValid).toBe(true);
  });

  it('rejects non-array color_ids / trait_ids and non-string members', () => {
    expect(V.exploreGalleryRecords({ color_ids: 'x' }).__isValid).toBe(false);
    expect(
      V.exploreGalleryRecords({ trait_ids: [123 as unknown as string] })
        .__isValid
    ).toBe(false);
  });

  it('rejects an invalid nail_length but accepts a valid one', () => {
    expect(V.exploreGalleryRecords({ nail_length: 'NOPE' }).__isValid).toBe(
      false
    );
    expect(
      V.exploreGalleryRecords({ nail_length: SOME_NAIL_LENGTH }).__isValid
    ).toBe(true);
  });

  it('rejects a non-boolean apply_strict_filter', () => {
    expect(
      V.exploreGalleryRecords({
        apply_strict_filter: 'yes' as unknown as boolean,
      }).__isValid
    ).toBe(false);
  });

  it('enforces the browse take bound and rejects an over-long city / searchQuery', () => {
    expect(
      V.exploreGalleryRecords({
        take: VALIDATION_PAGINATION.LIMIT_MAX_BROWSE + 1,
      }).__isValid
    ).toBe(false);
    expect(
      V.exploreGalleryRecords({ city: 'x'.repeat(10_000) }).__isValid
    ).toBe(false);
    expect(
      V.exploreGalleryRecords({ searchQuery: 'x'.repeat(10_000) }).__isValid
    ).toBe(false);
  });
});

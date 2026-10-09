/**
 * Characterization tests for publicValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validator
 * `getPublicStylistsList` (public stylists-list browse endpoint) as the safety net the
 * zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validator, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (VALIDATION_PAGINATION,
 * VALIDATION_LENGTHS), not hardcoded, so a limit change in the config moves these in lockstep.
 *
 * Sibling of gallery.validation.test.ts — same shape (EXEMPLAR for the FAZA 1 fan-out).
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import {
  VALIDATION_PAGINATION,
  VALIDATION_LENGTHS,
} from '@kernel/policies/validation.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('publicValidators.getPublicStylistsList', () => {
  describe('empty / absent payloads', () => {
    it('accepts an empty filter object (all fields optional, all omitted)', () => {
      const r = V.getPublicStylistsList({});
      expect(r.__isValid).toBe(true);
    });

    it('accepts undefined data (optional chaining skips every field)', () => {
      // typedData?.field !== undefined is false for all fields → nothing validated.
      expect(V.getPublicStylistsList(undefined).__isValid).toBe(true);
    });

    it('accepts null data (optional chaining skips every field)', () => {
      expect(V.getPublicStylistsList(null).__isValid).toBe(true);
    });

    it('accepts a fully-populated, in-range payload', () => {
      const r = V.getPublicStylistsList({
        cursor: 'abc123',
        take: VALIDATION_PAGINATION.LIMIT_MIN,
        city: 'Warszawa',
        searchQuery: 'french',
      });
      expect(r.__isValid).toBe(true);
    });
  });

  describe('cursor (optional non-empty string)', () => {
    it('accepts an omitted cursor', () => {
      expect(V.getPublicStylistsList({}).__isValid).toBe(true);
    });

    it('accepts a non-empty string cursor', () => {
      expect(V.getPublicStylistsList({ cursor: 'abc' }).__isValid).toBe(true);
    });

    it('rejects an empty-string cursor when provided', () => {
      const r = V.getPublicStylistsList({ cursor: '' });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'cursor')).toBe(true);
    });

    it('rejects a non-string cursor when provided', () => {
      const r = V.getPublicStylistsList({
        cursor: 123 as unknown as string,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'cursor')).toBe(true);
    });
  });

  describe('take (optional number, 1..LIMIT_MAX_BROWSE)', () => {
    it('accepts an omitted take', () => {
      expect(V.getPublicStylistsList({}).__isValid).toBe(true);
    });

    it('accepts take at the min boundary', () => {
      expect(
        V.getPublicStylistsList({ take: VALIDATION_PAGINATION.LIMIT_MIN })
          .__isValid
      ).toBe(true);
    });

    it('accepts take at the browse-max boundary', () => {
      expect(
        V.getPublicStylistsList({
          take: VALIDATION_PAGINATION.LIMIT_MAX_BROWSE,
        }).__isValid
      ).toBe(true);
    });

    it('rejects take below the min', () => {
      const r = V.getPublicStylistsList({
        take: VALIDATION_PAGINATION.LIMIT_MIN - 1,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'take')).toBe(true);
    });

    it('SECURITY: rejects take above the tighter browse cap (scrape-enumeration guard)', () => {
      // Browse endpoints use LIMIT_MAX_BROWSE (50), NOT the global LIMIT_MAX (100):
      // the general cap is intentionally too permissive here, so take=51 must reject.
      const r = V.getPublicStylistsList({
        take: VALIDATION_PAGINATION.LIMIT_MAX_BROWSE + 1,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'take')).toBe(true);
    });

    it('SECURITY: rejects the global LIMIT_MAX which exceeds the browse cap', () => {
      // Locks that this endpoint does NOT honor the larger global page size.
      expect(
        V.getPublicStylistsList({ take: VALIDATION_PAGINATION.LIMIT_MAX })
          .__isValid
      ).toBe(false);
    });

    it('rejects a non-number take when provided', () => {
      const r = V.getPublicStylistsList({
        take: '10' as unknown as number,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'take')).toBe(true);
    });
  });

  describe('city (optional string, max CITY_FILTER_MAX)', () => {
    it('accepts an omitted city', () => {
      expect(V.getPublicStylistsList({}).__isValid).toBe(true);
    });

    it('accepts a city at the max-length boundary', () => {
      expect(
        V.getPublicStylistsList({
          city: 'x'.repeat(VALIDATION_LENGTHS.CITY_FILTER_MAX),
        }).__isValid
      ).toBe(true);
    });

    it('accepts an empty-string city (length 0 is within max)', () => {
      // city is gated on `!== undefined` only; '' is a string of length 0 ≤ max → valid.
      expect(V.getPublicStylistsList({ city: '' }).__isValid).toBe(true);
    });

    it('rejects a city over the max length', () => {
      const r = V.getPublicStylistsList({
        city: 'x'.repeat(VALIDATION_LENGTHS.CITY_FILTER_MAX + 1),
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'city')).toBe(true);
    });

    it('rejects a non-string city when provided', () => {
      const r = V.getPublicStylistsList({
        city: 42 as unknown as string,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'city')).toBe(true);
    });
  });

  describe('searchQuery (optional string, max SEARCH_QUERY_MAX)', () => {
    it('accepts an omitted searchQuery', () => {
      expect(V.getPublicStylistsList({}).__isValid).toBe(true);
    });

    it('accepts a searchQuery at the max-length boundary', () => {
      expect(
        V.getPublicStylistsList({
          searchQuery: 'x'.repeat(VALIDATION_LENGTHS.SEARCH_QUERY_MAX),
        }).__isValid
      ).toBe(true);
    });

    it('accepts an empty-string searchQuery (length 0 is within max)', () => {
      expect(V.getPublicStylistsList({ searchQuery: '' }).__isValid).toBe(true);
    });

    it('rejects a searchQuery over the max length', () => {
      const r = V.getPublicStylistsList({
        searchQuery: 'x'.repeat(VALIDATION_LENGTHS.SEARCH_QUERY_MAX + 1),
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'searchQuery')).toBe(true);
    });

    it('rejects a non-string searchQuery when provided', () => {
      const r = V.getPublicStylistsList({
        searchQuery: { q: 'x' } as unknown as string,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'searchQuery')).toBe(true);
    });
  });

  describe('multi-field interaction', () => {
    it('rejects and flags EACH offending field independently', () => {
      const r = V.getPublicStylistsList({
        cursor: '',
        take: VALIDATION_PAGINATION.LIMIT_MAX_BROWSE + 1,
        city: 'x'.repeat(VALIDATION_LENGTHS.CITY_FILTER_MAX + 1),
        searchQuery: 'x'.repeat(VALIDATION_LENGTHS.SEARCH_QUERY_MAX + 1),
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'cursor')).toBe(true);
      expect(rejected(r, 'take')).toBe(true);
      expect(rejected(r, 'city')).toBe(true);
      expect(rejected(r, 'searchQuery')).toBe(true);
    });

    it('leaves untouched fields with an empty error string when only one is invalid', () => {
      const r = V.getPublicStylistsList({
        cursor: 'ok',
        take: VALIDATION_PAGINATION.LIMIT_MIN,
        city: 'x'.repeat(VALIDATION_LENGTHS.CITY_FILTER_MAX + 1),
        searchQuery: 'ok',
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'city')).toBe(true);
      expect(rejected(r, 'cursor')).toBe(false);
      expect(rejected(r, 'take')).toBe(false);
      expect(rejected(r, 'searchQuery')).toBe(false);
    });
  });
});

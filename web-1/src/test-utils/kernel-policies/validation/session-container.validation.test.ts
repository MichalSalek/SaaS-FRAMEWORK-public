/**
 * Characterization tests for sessionContainerValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validators as the safety net
 * the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT config (SESSION_CONTAINER_CONFIG —
 * SESSION_NAME_MAX_LENGTH, SESSION_NOTE_MAX_LENGTH), not hardcoded, so a cap change in the
 * config moves these in lockstep.
 *
 * Follows the gallery.validation.test.ts EXEMPLAR shape.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const NAME_MAX = SESSION_CONTAINER_CONFIG.SESSION_NAME_MAX_LENGTH;
const NOTE_MAX = SESSION_CONTAINER_CONFIG.SESSION_NOTE_MAX_LENGTH;

describe('sessionContainerValidators.sessionContainerCreate', () => {
  it('accepts an empty object (both fields optional)', () => {
    const r = V.sessionContainerCreate({});
    expect(r.__isValid).toBe(true);
  });

  it('accepts undefined / null data (defaults to {})', () => {
    expect(V.sessionContainerCreate(undefined).__isValid).toBe(true);
    expect(V.sessionContainerCreate(null).__isValid).toBe(true);
  });

  it('accepts a well-formed record', () => {
    const r = V.sessionContainerCreate({
      stylist_account_id: 'sa-1',
      name: 'Wesele kuzynki',
    });
    expect(r.__isValid).toBe(true);
  });

  it('rejects an empty-string stylist_account_id (it reached the DB as a dangling FK → 500)', () => {
    const r = V.sessionContainerCreate({ stylist_account_id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'stylist_account_id')).toBe(true);
  });

  it('rejects a non-string stylist_account_id (number/object/boolean)', () => {
    for (const bad of [123, {}, true, []]) {
      const r = V.sessionContainerCreate({
        stylist_account_id: bad as unknown as string,
      });
      expect(r.__isValid, `stylist_account_id=${JSON.stringify(bad)}`).toBe(
        false
      );
      expect(rejected(r, 'stylist_account_id')).toBe(true);
    }
  });

  it('accepts an explicitly undefined stylist_account_id', () => {
    const r = V.sessionContainerCreate({ stylist_account_id: undefined });
    expect(r.__isValid).toBe(true);
  });

  it('accepts name at the max length, rejects one over the cap', () => {
    expect(
      V.sessionContainerCreate({ name: 'x'.repeat(NAME_MAX) }).__isValid
    ).toBe(true);
    const over = V.sessionContainerCreate({ name: 'x'.repeat(NAME_MAX + 1) });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'name')).toBe(true);
  });

  it('CHARACTERIZATION: accepts an empty-string name (optional, length 0 <= max)', () => {
    expect(V.sessionContainerCreate({ name: '' }).__isValid).toBe(true);
  });

  it('rejects a non-string name', () => {
    const r = V.sessionContainerCreate({ name: 123 as unknown as string });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'name')).toBe(true);
  });
});

describe('sessionContainerValidators.sessionContainerAddPhoto', () => {
  const valid = { session_id: 's-1', gallery_record_id: 'g-1' };

  it('accepts a well-formed record', () => {
    expect(V.sessionContainerAddPhoto({ ...valid }).__isValid).toBe(true);
  });

  it('rejects a missing / empty session_id', () => {
    for (const bad of ['', undefined as unknown as string]) {
      const r = V.sessionContainerAddPhoto({ ...valid, session_id: bad });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'session_id')).toBe(true);
    }
  });

  it('rejects a missing / empty gallery_record_id', () => {
    for (const bad of ['', undefined as unknown as string]) {
      const r = V.sessionContainerAddPhoto({
        ...valid,
        gallery_record_id: bad,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'gallery_record_id')).toBe(true);
    }
  });

  it('rejects a non-string session_id / gallery_record_id', () => {
    expect(
      V.sessionContainerAddPhoto({
        ...valid,
        session_id: 123 as unknown as string,
      }).__isValid
    ).toBe(false);
    expect(
      V.sessionContainerAddPhoto({
        ...valid,
        gallery_record_id: {} as unknown as string,
      }).__isValid
    ).toBe(false);
  });

  it('reports BOTH fields when both are missing', () => {
    const r = V.sessionContainerAddPhoto({} as never);
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'session_id')).toBe(true);
    expect(rejected(r, 'gallery_record_id')).toBe(true);
  });
});

describe('sessionContainerValidators.sessionContainerShare', () => {
  it('requires a string session_id', () => {
    expect(V.sessionContainerShare({ session_id: 's-1' }).__isValid).toBe(true);
    expect(V.sessionContainerShare({ session_id: '' }).__isValid).toBe(false);
    expect(
      rejected(V.sessionContainerShare({ session_id: '' }), 'session_id')
    ).toBe(true);
    expect(
      V.sessionContainerShare({ session_id: 123 as unknown as string })
        .__isValid
    ).toBe(false);
  });

  it('rejects an empty / undefined / null payload', () => {
    expect(V.sessionContainerShare({} as never).__isValid).toBe(false);
    expect(V.sessionContainerShare(undefined).__isValid).toBe(false);
    expect(V.sessionContainerShare(null).__isValid).toBe(false);
  });
});

describe('sessionContainerValidators.sessionContainerClose', () => {
  it('requires a string session_id', () => {
    expect(V.sessionContainerClose({ session_id: 's-1' }).__isValid).toBe(true);
    expect(V.sessionContainerClose({ session_id: '' }).__isValid).toBe(false);
    expect(
      rejected(V.sessionContainerClose({ session_id: '' }), 'session_id')
    ).toBe(true);
    expect(
      V.sessionContainerClose({ session_id: true as unknown as string })
        .__isValid
    ).toBe(false);
  });

  it('rejects an empty payload', () => {
    expect(V.sessionContainerClose({} as never).__isValid).toBe(false);
  });
});

describe('sessionContainerValidators.sessionContainerGetMy', () => {
  it('CHARACTERIZATION: always valid regardless of input (no fields validated)', () => {
    expect(V.sessionContainerGetMy(undefined).__isValid).toBe(true);
    expect(V.sessionContainerGetMy({}).__isValid).toBe(true);
    expect(V.sessionContainerGetMy({ cursor: '', take: -999 }).__isValid).toBe(
      true
    );
    expect(V.sessionContainerGetMy({ anything: [1, 2, 3] }).__isValid).toBe(
      true
    );
  });
});

describe('sessionContainerValidators.sessionContainerSetNote', () => {
  const valid = {
    session_id: 's-1',
    note: 'some note',
    side: 'stylist' as const,
  };

  it('accepts a well-formed record (side=stylist)', () => {
    expect(V.sessionContainerSetNote({ ...valid }).__isValid).toBe(true);
  });

  it('accepts side=client', () => {
    expect(
      V.sessionContainerSetNote({ ...valid, side: 'client' }).__isValid
    ).toBe(true);
  });

  it('rejects a missing / empty session_id', () => {
    const r = V.sessionContainerSetNote({ ...valid, session_id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'session_id')).toBe(true);
  });

  it('CHARACTERIZATION: accepts an empty-string note (it is a string, 0 <= max)', () => {
    const r = V.sessionContainerSetNote({ ...valid, note: '' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'note')).toBe(false);
  });

  it('rejects a non-string note (incl. undefined)', () => {
    for (const bad of [undefined, null, 123, {}]) {
      const r = V.sessionContainerSetNote({
        ...valid,
        note: bad as unknown as string,
      });
      expect(r.__isValid, `note=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'note')).toBe(true);
    }
  });

  it('accepts note at the max length, rejects one over the cap', () => {
    expect(
      V.sessionContainerSetNote({ ...valid, note: 'x'.repeat(NOTE_MAX) })
        .__isValid
    ).toBe(true);
    const over = V.sessionContainerSetNote({
      ...valid,
      note: 'x'.repeat(NOTE_MAX + 1),
    });
    expect(over.__isValid).toBe(false);
    expect(rejected(over, 'note')).toBe(true);
  });

  it('rejects an invalid side (only stylist|client allowed)', () => {
    for (const bad of ['', 'admin', 'STYLIST', undefined, 123]) {
      const r = V.sessionContainerSetNote({
        ...valid,
        side: bad as unknown as 'stylist',
      });
      expect(r.__isValid, `side=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'side')).toBe(true);
    }
  });

  it('reports every offending field at once', () => {
    const r = V.sessionContainerSetNote({
      session_id: '',
      note: 'x'.repeat(NOTE_MAX + 1),
      side: 'nope' as unknown as 'stylist',
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'session_id')).toBe(true);
    expect(rejected(r, 'note')).toBe(true);
    expect(rejected(r, 'side')).toBe(true);
  });
});

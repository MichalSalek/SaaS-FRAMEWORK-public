/**
 * Characterization tests for adminNotesValidators: pins which field is rejected and
 * __isValid, not i18n text. Reached via adminNotesValidators -> adminValidators ->
 * VALIDATION_POLICY.validators. Shapes (SSOT .shared-kernel/policies/validation/admin-notes.validation.ts):
 *   adminSaveNote    <- { notes: string }
 *   adminSetMainNote <- { id: string }
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('adminNotesValidators.adminSaveNote', () => {
  it('accepts a non-empty string notes', () => {
    const r = V.adminSaveNote({
      notes: 'client prefers gel, allergic to acrylic',
    });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'notes')).toBe(false);
  });

  it('rejects a missing notes field (undefined) → error on notes', () => {
    const r = V.adminSaveNote({});
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'notes')).toBe(true);
  });

  it('rejects an empty-string notes (falsy) → error on notes', () => {
    const r = V.adminSaveNote({ notes: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'notes')).toBe(true);
  });

  it('rejects a non-string notes (number / object / array / null / boolean) → error on notes', () => {
    for (const bad of [
      123 as unknown as string,
      {} as unknown as string,
      [] as unknown as string,
      null as unknown as string,
      true as unknown as string,
    ]) {
      const r = V.adminSaveNote({ notes: bad });
      expect(r.__isValid, `notes=${String(bad)}`).toBe(false);
      expect(rejected(r, 'notes'), `notes=${String(bad)}`).toBe(true);
    }
  });

  it('CHARACTERIZATION: does NOT bound the notes length — a very long string is accepted', () => {
    // No max-length gate in the current validator; lock that it passes.
    const r = V.adminSaveNote({ notes: 'x'.repeat(100_000) });
    expect(r.__isValid).toBe(true);
  });

  it('CHARACTERIZATION: a whitespace-only notes is accepted (truthy non-empty string, no trim/whitespace gate)', () => {
    const r = V.adminSaveNote({ notes: '   ' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'notes')).toBe(false);
  });

  it('CHARACTERIZATION: extra unknown keys on the payload are ignored (only notes is validated)', () => {
    const r = V.adminSaveNote({
      notes: 'ok',
      account_id: 'spoofed',
      id: 'spoofed',
    } as unknown as {
      notes: string;
    });
    expect(r.__isValid).toBe(true);
  });
});

describe('adminNotesValidators.adminSetMainNote (delegates to validateRequiredId)', () => {
  it('accepts a non-empty string id → error on id field is empty', () => {
    const r = V.adminSetMainNote({ id: 'note-123' });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'id')).toBe(false);
  });

  it('rejects a missing id (undefined / empty payload) → error on id', () => {
    expect(V.adminSetMainNote({}).__isValid).toBe(false);
    expect(rejected(V.adminSetMainNote({}), 'id')).toBe(true);
  });

  it('rejects an empty-string id (falsy) → error on id', () => {
    const r = V.adminSetMainNote({ id: '' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
  });

  it('rejects a non-string id (number / object / array / null / boolean) → error on id', () => {
    for (const bad of [
      123 as unknown as string,
      {} as unknown as string,
      [] as unknown as string,
      null as unknown as string,
      true as unknown as string,
    ]) {
      const r = V.adminSetMainNote({ id: bad });
      expect(r.__isValid, `id=${String(bad)}`).toBe(false);
      expect(rejected(r, 'id'), `id=${String(bad)}`).toBe(true);
    }
  });

  it('CHARACTERIZATION: a null / undefined payload itself is handled (rejects on id, no throw)', () => {
    expect(V.adminSetMainNote(null).__isValid).toBe(false);
    expect(V.adminSetMainNote(undefined).__isValid).toBe(false);
    expect(rejected(V.adminSetMainNote(null), 'id')).toBe(true);
  });

  it('CHARACTERIZATION: id format/length is NOT validated — any non-empty string passes', () => {
    expect(V.adminSetMainNote({ id: 'x' }).__isValid).toBe(true);
    expect(V.adminSetMainNote({ id: '   ' }).__isValid).toBe(true); // whitespace-only is truthy → accepted
    expect(V.adminSetMainNote({ id: 'x'.repeat(10_000) }).__isValid).toBe(true);
  });
});

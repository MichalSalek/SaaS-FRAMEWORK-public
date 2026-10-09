/**
 * Characterization tests for adminAnnouncementsValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel request validators as the safety net
 * the zod migration (FAZA 2) must preserve — every assertion below is GREEN against the
 * hand-written validators, so a zod rewrite that changes a field's accept/reject decision
 * (or which field carries the error) flips a test. They assert the validation LOGIC
 * (which field is rejected, __isValid), NOT exact i18n message text (brittle) — a rejected
 * field is asserted via a non-empty error string, an accepted field via an empty one.
 *
 * Valid/boundary inputs are DERIVED from the SSOT configs (VALIDATION_LENGTHS,
 * ANNOUNCEMENT_TYPES), not hardcoded, so a limit change in the config moves these in lockstep.
 *
 * Follows the gallery.validation.test.ts exemplar shape (FAZA 1 fan-out).
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { ANNOUNCEMENT_TYPES } from '@kernel/domain/admin/announcements.config';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

const SOME_TYPE = ANNOUNCEMENT_TYPES[0] as string; // 'info'
const TITLE_MAX = VALIDATION_LENGTHS.ANNOUNCEMENT_TITLE_MAX;
const MESSAGE_MAX = VALIDATION_LENGTHS.ANNOUNCEMENT_MESSAGE_MAX;

describe('adminAnnouncementsValidators.adminGetAnnouncements', () => {
  it('ALWAYS valid — ignores its input entirely', () => {
    expect(V.adminGetAnnouncements(undefined).__isValid).toBe(true);
    expect(V.adminGetAnnouncements({}).__isValid).toBe(true);
    expect(V.adminGetAnnouncements({ anything: 'garbage' }).__isValid).toBe(
      true
    );
    expect(V.adminGetAnnouncements(null).__isValid).toBe(true);
  });
});

describe('adminAnnouncementsValidators.announcementsGetActive', () => {
  it('ALWAYS valid — ignores its input entirely', () => {
    expect(V.announcementsGetActive(undefined).__isValid).toBe(true);
    expect(V.announcementsGetActive({}).__isValid).toBe(true);
    expect(V.announcementsGetActive({ anything: 'garbage' }).__isValid).toBe(
      true
    );
    expect(V.announcementsGetActive(null).__isValid).toBe(true);
  });
});

describe('adminAnnouncementsValidators.adminCreateAnnouncement', () => {
  const valid = {
    title: 'Maintenance window',
    message: 'We will be down for 10 minutes.',
    type: SOME_TYPE,
    is_active: true,
  };

  it('accepts a well-formed announcement', () => {
    expect(V.adminCreateAnnouncement({ ...valid }).__isValid).toBe(true);
  });

  // --- title ---
  it('rejects a missing / empty / whitespace-only / non-string title', () => {
    for (const bad of ['', '   ', undefined, null, 123, {}]) {
      const r = V.adminCreateAnnouncement({ ...valid, title: bad });
      expect(r.__isValid, `title=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'title'), `title=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  it('rejects a title over ANNOUNCEMENT_TITLE_MAX (trimmed) but accepts exactly at max', () => {
    const atMax = 'x'.repeat(TITLE_MAX);
    const overMax = 'x'.repeat(TITLE_MAX + 1);
    expect(
      V.adminCreateAnnouncement({ ...valid, title: atMax }).__isValid
    ).toBe(true);
    const r = V.adminCreateAnnouncement({ ...valid, title: overMax });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'title')).toBe(true);
  });

  // --- message ---
  it('rejects a missing / empty / whitespace-only / non-string message', () => {
    for (const bad of ['', '   ', undefined, null, 123, {}]) {
      const r = V.adminCreateAnnouncement({ ...valid, message: bad });
      expect(r.__isValid, `message=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'message'), `message=${JSON.stringify(bad)}`).toBe(
        true
      );
    }
  });

  it('rejects a message over ANNOUNCEMENT_MESSAGE_MAX (trimmed) but accepts exactly at max', () => {
    const atMax = 'y'.repeat(MESSAGE_MAX);
    const overMax = 'y'.repeat(MESSAGE_MAX + 1);
    expect(
      V.adminCreateAnnouncement({ ...valid, message: atMax }).__isValid
    ).toBe(true);
    const r = V.adminCreateAnnouncement({ ...valid, message: overMax });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'message')).toBe(true);
  });

  // --- type ---
  it('accepts every type in ANNOUNCEMENT_TYPES', () => {
    for (const t of ANNOUNCEMENT_TYPES) {
      expect(
        V.adminCreateAnnouncement({ ...valid, type: t }).__isValid,
        `type=${t}`
      ).toBe(true);
    }
  });

  it('rejects a type not in ANNOUNCEMENT_TYPES (incl. wrong-case, missing, non-string)', () => {
    for (const bad of ['INFO', 'spam', '', undefined, null, 1]) {
      const r = V.adminCreateAnnouncement({ ...valid, type: bad });
      expect(r.__isValid, `type=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'type'), `type=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  // --- is_active (REQUIRED boolean on create) ---
  it('requires is_active to be a boolean (missing / non-boolean rejected)', () => {
    for (const bad of [undefined, null, 'true', 1, 0]) {
      const r = V.adminCreateAnnouncement({ ...valid, is_active: bad });
      expect(r.__isValid, `is_active=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'is_active'), `is_active=${JSON.stringify(bad)}`).toBe(
        true
      );
    }
    expect(
      V.adminCreateAnnouncement({ ...valid, is_active: false }).__isValid
    ).toBe(true);
  });

  // --- starts_at / ends_at (optional strings; undefined OK, null NOT) ---
  it('accepts omitted (undefined) starts_at / ends_at', () => {
    expect(
      V.adminCreateAnnouncement({
        ...valid,
        starts_at: undefined,
        ends_at: undefined,
      }).__isValid
    ).toBe(true);
  });

  it('accepts string starts_at / ends_at', () => {
    expect(
      V.adminCreateAnnouncement({
        ...valid,
        starts_at: '2026-01-01T00:00:00Z',
        ends_at: '2026-02-01T00:00:00Z',
      }).__isValid
    ).toBe(true);
  });

  it('CHARACTERIZATION: on CREATE, null starts_at / ends_at is REJECTED (only undefined or string pass)', () => {
    // typeof null !== 'string' and null !== undefined → error added.
    const rs = V.adminCreateAnnouncement({ ...valid, starts_at: null });
    expect(rs.__isValid).toBe(false);
    expect(rejected(rs, 'starts_at')).toBe(true);
    const re = V.adminCreateAnnouncement({ ...valid, ends_at: null });
    expect(re.__isValid).toBe(false);
    expect(rejected(re, 'ends_at')).toBe(true);
  });

  it('rejects non-string starts_at / ends_at (number/object)', () => {
    expect(
      rejected(
        V.adminCreateAnnouncement({ ...valid, starts_at: 123 }),
        'starts_at'
      )
    ).toBe(true);
    expect(
      rejected(V.adminCreateAnnouncement({ ...valid, ends_at: {} }), 'ends_at')
    ).toBe(true);
  });

  it('reports multiple field errors at once and stays invalid', () => {
    const r = V.adminCreateAnnouncement({
      title: '',
      message: '',
      type: 'nope',
      is_active: 'x',
    });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'title')).toBe(true);
    expect(rejected(r, 'message')).toBe(true);
    expect(rejected(r, 'type')).toBe(true);
    expect(rejected(r, 'is_active')).toBe(true);
  });

  it('rejects a fully missing payload (undefined/null data)', () => {
    expect(V.adminCreateAnnouncement(undefined).__isValid).toBe(false);
    expect(V.adminCreateAnnouncement(null).__isValid).toBe(false);
  });
});

describe('adminAnnouncementsValidators.adminUpdateAnnouncement (partial update)', () => {
  const id = 'announcement-1';

  it('accepts a payload with only a valid id (all other fields omitted)', () => {
    expect(V.adminUpdateAnnouncement({ id }).__isValid).toBe(true);
  });

  it('requires a truthy string id', () => {
    for (const bad of ['', undefined, null, 123, {}]) {
      const r = V.adminUpdateAnnouncement({ id: bad });
      expect(r.__isValid, `id=${JSON.stringify(bad)}`).toBe(false);
      expect(rejected(r, 'id'), `id=${JSON.stringify(bad)}`).toBe(true);
    }
  });

  // --- PARTIAL semantics: provided optional fields ARE validated ---
  it('PARTIAL: omitted optional fields are NOT validated', () => {
    expect(V.adminUpdateAnnouncement({ id }).__isValid).toBe(true);
    // explicit undefined on each optional field is treated as "omitted"
    expect(
      V.adminUpdateAnnouncement({
        id,
        title: undefined,
        message: undefined,
        type: undefined,
        is_active: undefined,
        starts_at: undefined,
        ends_at: undefined,
      }).__isValid
    ).toBe(true);
  });

  it('PARTIAL title: provided value IS validated (empty/over-max rejected, in-range accepted)', () => {
    expect(
      rejected(V.adminUpdateAnnouncement({ id, title: '' }), 'title')
    ).toBe(true);
    expect(
      rejected(V.adminUpdateAnnouncement({ id, title: '   ' }), 'title')
    ).toBe(true);
    expect(
      rejected(
        V.adminUpdateAnnouncement({ id, title: 'x'.repeat(TITLE_MAX + 1) }),
        'title'
      )
    ).toBe(true);
    expect(
      V.adminUpdateAnnouncement({ id, title: 'New title' }).__isValid
    ).toBe(true);
  });

  it('PARTIAL message: provided value IS validated (empty/over-max rejected, in-range accepted)', () => {
    expect(
      rejected(V.adminUpdateAnnouncement({ id, message: '' }), 'message')
    ).toBe(true);
    expect(
      rejected(
        V.adminUpdateAnnouncement({ id, message: 'y'.repeat(MESSAGE_MAX + 1) }),
        'message'
      )
    ).toBe(true);
    expect(
      V.adminUpdateAnnouncement({ id, message: 'New message' }).__isValid
    ).toBe(true);
  });

  it('PARTIAL type: provided value must be in ANNOUNCEMENT_TYPES', () => {
    expect(
      rejected(V.adminUpdateAnnouncement({ id, type: 'nope' }), 'type')
    ).toBe(true);
    expect(V.adminUpdateAnnouncement({ id, type: SOME_TYPE }).__isValid).toBe(
      true
    );
  });

  it('PARTIAL is_active: provided value must be a boolean', () => {
    expect(
      rejected(V.adminUpdateAnnouncement({ id, is_active: 'x' }), 'is_active')
    ).toBe(true);
    expect(V.adminUpdateAnnouncement({ id, is_active: false }).__isValid).toBe(
      true
    );
    expect(V.adminUpdateAnnouncement({ id, is_active: true }).__isValid).toBe(
      true
    );
  });

  it('CHARACTERIZATION: on UPDATE, null starts_at / ends_at IS accepted (clear-the-date semantics)', () => {
    // Update guards on `!== undefined && !== null` → null passes (unlike create).
    expect(V.adminUpdateAnnouncement({ id, starts_at: null }).__isValid).toBe(
      true
    );
    expect(V.adminUpdateAnnouncement({ id, ends_at: null }).__isValid).toBe(
      true
    );
  });

  it('PARTIAL starts_at / ends_at: string accepted, other non-string rejected', () => {
    expect(
      V.adminUpdateAnnouncement({
        id,
        starts_at: '2026-01-01',
        ends_at: '2026-02-01',
      }).__isValid
    ).toBe(true);
    expect(
      rejected(V.adminUpdateAnnouncement({ id, starts_at: 123 }), 'starts_at')
    ).toBe(true);
    expect(
      rejected(V.adminUpdateAnnouncement({ id, ends_at: {} }), 'ends_at')
    ).toBe(true);
  });

  it('reports id error even when optional fields are also invalid', () => {
    const r = V.adminUpdateAnnouncement({ id: '', title: '', type: 'nope' });
    expect(r.__isValid).toBe(false);
    expect(rejected(r, 'id')).toBe(true);
    expect(rejected(r, 'title')).toBe(true);
    expect(rejected(r, 'type')).toBe(true);
  });
});

describe('adminAnnouncementsValidators.adminDeleteAnnouncement', () => {
  it('requires a truthy string id', () => {
    expect(V.adminDeleteAnnouncement({ id: 'announcement-1' }).__isValid).toBe(
      true
    );
    expect(V.adminDeleteAnnouncement({ id: '' }).__isValid).toBe(false);
    expect(V.adminDeleteAnnouncement({ id: undefined }).__isValid).toBe(false);
    expect(
      V.adminDeleteAnnouncement({ id: 123 as unknown as string }).__isValid
    ).toBe(false);
    expect(V.adminDeleteAnnouncement(undefined).__isValid).toBe(false);
    expect(V.adminDeleteAnnouncement(null).__isValid).toBe(false);
  });

  it('rejected id field carries the error', () => {
    expect(rejected(V.adminDeleteAnnouncement({ id: '' }), 'id')).toBe(true);
  });
});

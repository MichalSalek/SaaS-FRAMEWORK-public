/**
 * SessionContainer concurrency-helper unit tests (domain-unit).
 *
 * This helper carries its OWN error-classification logic (finding
 * session-container-3), so it gets a dedicated file:
 *   - isP2002: STRUCTURAL detection (error.code), never instanceof — Turbopack
 *     duplicates Prisma class identities, so instanceof is a known false-negative.
 *   - classifyUniqueConstraintViolation: adapter-pg cause parsing — index-name
 *     match first, constraint-fields fallback (with pg's quoted `"position"`
 *     normalization), defensive shape-guards ('other'/'unknown' → generic DB
 *     error, NEVER a fabricated 429 or a throw inside add-photo's catch).
 *   - lockSessionContainerRow: row-or-null contract on the FOR UPDATE select.
 *   - isConcurrencyConflict: deadlock (40P01) OR serialization (P2034 /
 *     TransactionWriteConflict) shapes are retryable; everything else is not.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  classifyUniqueConstraintViolation,
  isConcurrencyConflict,
  isP2002,
  lockSessionContainerRow,
} from './session-container-concurrency.helper';
import type { Prisma } from '../../../prisma/js-client';

const SESSION_ID = 'sess_test_000000000000001';

const makeAdapterP2002 = (cause: Record<string, unknown>) => ({
  code: 'P2002',
  meta: { driverAdapterError: { cause } },
});

describe('isP2002 — structural detection (Turbopack-safe)', () => {
  it('matches any object carrying code=P2002 (plain object or Error subclass)', () => {
    expect(isP2002({ code: 'P2002' })).toBe(true);
    expect(isP2002(Object.assign(new Error('dup'), { code: 'P2002' }))).toBe(
      true
    );
  });

  it('rejects other codes, bare errors and non-objects', () => {
    expect(isP2002({ code: 'P2025' })).toBe(false);
    expect(isP2002(new Error('P2002'))).toBe(false);
    expect(isP2002(null)).toBe(false);
    expect(isP2002('P2002')).toBe(false);
  });
});

describe('classifyUniqueConstraintViolation — adapter-pg cause routing', () => {
  it('no meta / malformed error → unknown (caller maps to generic DB error)', () => {
    expect(classifyUniqueConstraintViolation({ code: 'P2002' })).toBe(
      'unknown'
    );
    expect(classifyUniqueConstraintViolation(null)).toBe('unknown');
    expect(
      classifyUniqueConstraintViolation({ meta: { driverAdapterError: {} } })
    ).toBe('unknown');
  });

  it('active_pair by index NAME in originalMessage', () => {
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          originalMessage:
            'duplicate key value violates unique constraint "session_container_active_pair_uq"',
        })
      )
    ).toBe('active_pair');
  });

  it('active_pair by constraint FIELDS fallback', () => {
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          constraint: { fields: ['client_account_id', 'stylist_account_id'] },
        })
      )
    ).toBe('active_pair');
  });

  it('duplicate_photo by index NAME and by fields fallback', () => {
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          originalMessage:
            'duplicate key value violates unique constraint "SessionContainerPhoto_session_id_gallery_record_id_key"',
        })
      )
    ).toBe('duplicate_photo');
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          constraint: { fields: ['session_id', 'gallery_record_id'] },
        })
      )
    ).toBe('duplicate_photo');
  });

  it('position by index NAME and by fields fallback incl. pg-quoted "position"', () => {
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          originalMessage:
            'duplicate key value violates unique constraint "SessionContainerPhoto_session_id_position_key"',
        })
      )
    ).toBe('position');
    // pg quotes the reserved word `position` in the detail fields.
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          constraint: { fields: ['session_id', '"position"'] },
        })
      )
    ).toBe('position');
  });

  it("UNRECOGNIZED constraint → 'other' (must not fabricate a 429 nor retry)", () => {
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          originalMessage:
            'duplicate key value violates unique constraint "SomeOther_table_key"',
          constraint: { fields: ['some_other_column'] },
        })
      )
    ).toBe('other');
  });

  it("defensive shape-guard: non-string message / non-string-array fields NEVER throw → 'other'", () => {
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          originalMessage: 12345,
          constraint: { fields: 'not-an-array' },
        })
      )
    ).toBe('other');
    expect(
      classifyUniqueConstraintViolation(
        makeAdapterP2002({
          constraint: { fields: [42, null, { nested: true }] },
        })
      )
    ).toBe('other');
  });
});

// lock-discipline-allow: describe title cites FOR UPDATE documentarily — no SQL lock here
describe('lockSessionContainerRow — FOR UPDATE row-or-null contract', () => {
  it('returns the locked row when the session exists', async () => {
    const queryRaw = vi.fn(async () => [{ id: SESSION_ID }]);
    const tx = { $queryRaw: queryRaw } as unknown as Prisma.TransactionClient;

    const locked = await lockSessionContainerRow(tx, SESSION_ID);

    expect(locked).toEqual({ id: SESSION_ID });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns null when the row vanished (cascade between pre-flight and TX)', async () => {
    const tx = {
      $queryRaw: async () => [],
    } as unknown as Prisma.TransactionClient;

    expect(await lockSessionContainerRow(tx, SESSION_ID)).toBeNull();
  });
});

describe('isConcurrencyConflict — retryable transient aborts only', () => {
  it('deadlock 40P01 (top-level or nested code) → true', () => {
    expect(isConcurrencyConflict({ code: '40P01' })).toBe(true);
    expect(isConcurrencyConflict({ originalCode: '40P01' })).toBe(true);
  });

  it('serialization conflict shapes (P2034 / TransactionWriteConflict kind) → true', () => {
    expect(isConcurrencyConflict({ code: 'P2034' })).toBe(true);
    expect(
      isConcurrencyConflict({ cause: { kind: 'TransactionWriteConflict' } })
    ).toBe(true);
  });

  it('ordinary errors (incl. P2002) → false, they must NOT be blind-retried', () => {
    expect(isConcurrencyConflict({ code: 'P2002' })).toBe(false);
    expect(isConcurrencyConflict(new Error('connection reset'))).toBe(false);
    expect(isConcurrencyConflict(null)).toBe(false);
  });
});

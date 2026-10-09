/**
 * Gallery-list unit tests — getGalleryRecords_IO (owner-scoped cursor pagination).
 *
 * Locks in:
 *
 *  - WHERE always owner-scoped (created_by_account_id) — the list never crosses
 *    stylists; missing account id → VALIDATION_ERROR;
 *  - uniform cursor contract: malformed format rejected BEFORE any DB access,
 *    stale-but-well-formed cursor rejected via the existence pre-check (Prisma
 *    findMany would silently return [] instead of throwing), valid cursor passed
 *    as { cursor, skip:1 };
 *  - take clamped to [1,100] and fetched as take+1 (hasMore sentinel row);
 *    nextCursor = last page item when an extra row came back, null at end;
 *  - strict filter → AND of per-id `some`; loose filter → single `in` some;
 *  - P2025 fallback maps to VALIDATION_ERROR cursor (not a DB outage).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getGalleryRecords_IO } from './gallery-list.query';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';

const ACCOUNT_ID = 'acc_test_0000000000000001';
// isValidCursorFormat: /^[a-z0-9]{20,40}$/
const VALID_CURSOR = 'abc123abc123abc123abc123';

const makeRecord = (id: string) => ({
  gallery_record_id: id,
  asset_url: `https://res.cloudinary.com/test/image/upload/v1/${id}.jpg`,
  nail_length: NAIL_LENGTHS.SHORT,
  is_pinned: false,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  colors: [],
  traits: [],
});

const mockScenario = ({
  records = [makeRecord('gr1record00000000001')] as ReturnType<
    typeof makeRecord
  >[],
  cursorExists = true,
} = {}) => {
  const findMany = vi.fn(async (_arg: unknown) => records);
  // Cursor existence pre-check = OWNER-SCOPED findFirst (cursor-oracle hardening,
  // 4ae025c0): where zawiera created_by_account_id, więc findUnique (PK-only) nie
  // może go obsłużyć — mock odzwierciedla realny kształt zapytania.
  const findFirst = vi.fn(async () =>
    cursorExists ? { gallery_record_id: VALID_CURSOR } : null
  );
  mockDb({ galleryRecord: { findMany, findFirst } });
  return { findMany, findFirst };
};

const baseProps = {
  created_by_account_id: ACCOUNT_ID,
  color_ids: [] as string[],
  trait_ids: [] as string[],
  apply_strict_filter: false,
};

describe('getGalleryRecords_IO — owner list + uniform cursor contract', () => {
  it('missing account id → VALIDATION_ERROR (no DB access)', async () => {
    mockDb({});

    const result = await getGalleryRecords_IO({
      props: { ...baseProps, created_by_account_id: '' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
  });

  it('WHERE is owner-scoped; default take 50 fetched as 51 (hasMore sentinel)', async () => {
    const { findMany } = mockScenario();

    const result = await getGalleryRecords_IO({ props: baseProps });

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { created_by_account_id: string };
      take: number;
      orderBy: unknown;
    };
    expect(arg.where.created_by_account_id).toBe(ACCOUNT_ID);
    expect(arg.take).toBe(51);
    // Stable pagination: created_at + PK tiebreaker.
    expect(arg.orderBy).toEqual([
      { created_at: 'desc' },
      { gallery_record_id: 'desc' },
    ]);
  });

  it('take is clamped: 500 → 100 (+1 sentinel), 0 → 1 (+1 sentinel)', async () => {
    const { findMany } = mockScenario();
    await getGalleryRecords_IO({ props: { ...baseProps, take: 500 } });
    await getGalleryRecords_IO({ props: { ...baseProps, take: 0 } });

    const firstArg = findMany.mock.calls[0]?.[0] as { take: number };
    const secondArg = findMany.mock.calls[1]?.[0] as { take: number };
    expect(firstArg.take).toBe(101);
    expect(secondArg.take).toBe(2);
  });

  it('hasMore: take+1 rows returned → page sliced to take, nextCursor = last page item', async () => {
    const rows = [
      makeRecord('gr1record00000000001'),
      makeRecord('gr2record00000000002'),
      makeRecord('gr3record00000000003'),
    ];
    mockScenario({ records: rows });

    const result = await getGalleryRecords_IO({
      props: { ...baseProps, take: 2 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.records).toHaveLength(2);
      expect(result.data.nextCursor).toBe('gr2record00000000002');
    }
  });

  it('end of list: fewer rows than take → nextCursor null', async () => {
    mockScenario({ records: [makeRecord('gr1record00000000001')] });

    const result = await getGalleryRecords_IO({
      props: { ...baseProps, take: 2 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.records).toHaveLength(1);
      expect(result.data.nextCursor).toBeNull();
    }
  });

  it('malformed cursor → VALIDATION_ERROR BEFORE any DB access (format gate)', async () => {
    const { findMany, findFirst } = mockScenario();

    const result = await getGalleryRecords_IO({
      props: { ...baseProps, cursor: 'NOT-A-CUID!' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('cursor');
      }
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('stale (non-existent) cursor → VALIDATION_ERROR, never a silent empty 200', async () => {
    const { findMany } = mockScenario({ cursorExists: false });

    const result = await getGalleryRecords_IO({
      props: { ...baseProps, cursor: VALID_CURSOR },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('cursor');
      }
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('valid existing cursor → findMany receives { cursor, skip:1 }', async () => {
    const { findMany } = mockScenario();

    const result = await getGalleryRecords_IO({
      props: { ...baseProps, cursor: VALID_CURSOR },
    });

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as {
      cursor: { gallery_record_id: string };
      skip: number;
    };
    expect(arg.cursor).toEqual({ gallery_record_id: VALID_CURSOR });
    expect(arg.skip).toBe(1);
  });

  it('strict filter → AND of per-id some; loose filter → single `in` some', async () => {
    const { findMany } = mockScenario();

    await getGalleryRecords_IO({
      props: {
        ...baseProps,
        color_ids: ['color_1', 'color_2'],
        apply_strict_filter: true,
      },
    });
    await getGalleryRecords_IO({
      props: {
        ...baseProps,
        color_ids: ['color_1', 'color_2'],
        apply_strict_filter: false,
      },
    });

    const strictArg = findMany.mock.calls[0]?.[0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(strictArg.where.AND).toEqual([
      { colors: { some: { color_id: 'color_1' } } },
      { colors: { some: { color_id: 'color_2' } } },
    ]);
    const looseArg = findMany.mock.calls[1]?.[0] as {
      where: { colors: { some: { color_id: { in: string[] } } } };
    };
    expect(looseArg.where.colors.some.color_id.in).toEqual([
      'color_1',
      'color_2',
    ]);
  });

  it('P2025 from the page query → VALIDATION_ERROR cursor (defensive fallback), not DATABASE_ERROR', async () => {
    const { findMany } = mockScenario();
    findMany.mockImplementation(async () => {
      throw Object.assign(new Error('Record not found.'), { code: 'P2025' });
    });

    const result = await getGalleryRecords_IO({ props: baseProps });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('cursor');
      }
    }
  });

  it('unknown DB throw → DATABASE_ERROR', async () => {
    const { findMany } = mockScenario();
    findMany.mockImplementation(async () => {
      throw new Error('connection reset');
    });

    const result = await getGalleryRecords_IO({ props: baseProps });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

/**
 * Gallery-update unit tests — updateGalleryRecord_IO.
 *
 * Locks in the partial-update contract:
 *
 *  - curation gate (parity with create): inactive/non-existent color/trait ids →
 *    VALIDATION_ERROR BEFORE the tx (no junction replace, no update);
 *  - anti-enumeration mask: foreign record → GALLERY_RECORD_NOT_FOUND (never
 *    OWNERSHIP_ERROR) and NO mutation ran;
 *  - junction replace: deleteMany+createMany fired ONLY for the dictionaries
 *    actually provided (partial update semantics), with deduped rows;
 *  - final update WHERE is double-scoped (gallery_record_id AND
 *    created_by_account_id) and the response maps junction rows to the DTO shape;
 *  - P2003 inside the tx → VALIDATION_ERROR; P2025 (record vanished mid-tx) →
 *    GALLERY_RECORD_NOT_FOUND (both never DATABASE_ERROR).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { updateGalleryRecord_IO } from './gallery-update.operation';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';

const ACCOUNT_ID = 'acc_test_0000000000000001';
const OTHER_ACCOUNT_ID = 'acc_test_9999999999999999';
const RECORD_ID = 'gr_test_0000000000000001';
const OP_ID = 'op_test_0000000000000001';

const UPDATED_ROW = {
  gallery_record_id: RECORD_ID,
  nail_length: NAIL_LENGTHS.LONG,
  colors: [{ color: { id: 'color_1', name: 'Red', hex_code: '#ff0000' } }],
  traits: [
    {
      trait: {
        id: 'trait_1',
        name: 'French',
        category: 'style',
        icon_url: null,
        is_featured: true,
      },
    },
  ],
};

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const mockScenario = ({
  owner = ACCOUNT_ID as string,
  exists = true,
  activeColorIds = ['color_1'] as string[],
  activeTraitIds = ['trait_1'] as string[],
} = {}) => {
  // lockGalleryRecord = tx.$queryRaw (FOR NO KEY UPDATE) returning the owner row.
  const lockQuery = vi.fn(async () =>
    exists ? [{ created_by_account_id: owner }] : []
  );
  const update = vi.fn(async (_arg: unknown) => UPDATED_ROW);
  const colorDeleteMany = vi.fn(async () => ({ count: 1 }));
  const colorCreateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
  const traitDeleteMany = vi.fn(async () => ({ count: 1 }));
  const traitCreateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
  mockDb({
    color: {
      findMany: vi.fn(async () => activeColorIds.map(id => ({ id }))),
    },
    trait: {
      findMany: vi.fn(async () => activeTraitIds.map(id => ({ id }))),
    },
    $queryRaw: rawStub(lockQuery),
    galleryRecord: { update },
    galleryRecordColor: {
      deleteMany: colorDeleteMany,
      createMany: colorCreateMany,
    },
    galleryRecordTrait: {
      deleteMany: traitDeleteMany,
      createMany: traitCreateMany,
    },
  });
  return {
    lockQuery,
    update,
    colorDeleteMany,
    colorCreateMany,
    traitDeleteMany,
    traitCreateMany,
  };
};

const makeArgs = (
  props: Partial<{
    color_ids: string[];
    trait_ids: string[];
    nail_length: (typeof NAIL_LENGTHS)[keyof typeof NAIL_LENGTHS];
  }> = {}
) => ({
  props: {
    created_by_account_id: ACCOUNT_ID,
    gallery_record_id: RECORD_ID,
    ...props,
  },
  id: OP_ID,
});

describe('updateGalleryRecord_IO — partial update + curation + mask', () => {
  it('full update: replaces both junctions (deduped), update double-scoped by record AND owner, maps DTO', async () => {
    const {
      update,
      colorDeleteMany,
      colorCreateMany,
      traitDeleteMany,
      traitCreateMany,
    } = mockScenario();

    const result = await updateGalleryRecord_IO(
      makeArgs({
        color_ids: ['color_1', 'color_1'],
        trait_ids: ['trait_1'],
        nail_length: NAIL_LENGTHS.LONG,
      })
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gallery_record_id).toBe(RECORD_ID);
      expect(result.data.nail_length).toBe(NAIL_LENGTHS.LONG);
      expect(result.data.colors).toEqual([
        { id: 'color_1', name: 'Red', hex_code: '#ff0000' },
      ]);
      expect(result.data.traits).toEqual([
        {
          id: 'trait_1',
          name: 'French',
          category: 'style',
          icon_url: null,
          is_featured: true,
        },
      ]);
    }

    // Junction replace: wipe-then-recreate, scoped to this record, deduped rows.
    expect(colorDeleteMany).toHaveBeenCalledWith({
      where: { gallery_record_id: RECORD_ID },
    });
    const colorRows = colorCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ gallery_record_id: string; color_id: string }>;
    };
    expect(colorRows.data).toEqual([
      { gallery_record_id: RECORD_ID, color_id: 'color_1' },
    ]);
    expect(traitDeleteMany).toHaveBeenCalledTimes(1);
    expect(traitCreateMany).toHaveBeenCalledTimes(1);

    // Final update WHERE carries BOTH the record id and the owner (scoping).
    const updateArg = update.mock.calls[0]?.[0] as {
      where: { gallery_record_id: string; created_by_account_id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where.gallery_record_id).toBe(RECORD_ID);
    expect(updateArg.where.created_by_account_id).toBe(ACCOUNT_ID);
    expect(updateArg.data).toEqual({ nail_length: NAIL_LENGTHS.LONG });
  });

  it('partial update (nail_length only): junctions NOT touched', async () => {
    const {
      update,
      colorDeleteMany,
      colorCreateMany,
      traitDeleteMany,
      traitCreateMany,
    } = mockScenario();

    const result = await updateGalleryRecord_IO(
      makeArgs({ nail_length: NAIL_LENGTHS.SHORT })
    );

    expect(result.success).toBe(true);
    expect(colorDeleteMany).not.toHaveBeenCalled();
    expect(colorCreateMany).not.toHaveBeenCalled();
    expect(traitDeleteMany).not.toHaveBeenCalled();
    expect(traitCreateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('nail_length omitted: update runs with EMPTY data (junction-only edit)', async () => {
    const { update } = mockScenario();

    const result = await updateGalleryRecord_IO(
      makeArgs({ color_ids: ['color_1'] })
    );

    expect(result.success).toBe(true);
    const updateArg = update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toEqual({});
  });

  it('curation gate: retired color_id → VALIDATION_ERROR before the tx, zero mutations', async () => {
    const { lockQuery, update, colorDeleteMany } = mockScenario({
      activeColorIds: [],
    });

    const result = await updateGalleryRecord_IO(
      makeArgs({ color_ids: ['color_retired'] })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('color_ids');
      }
    }
    // The gate fires BEFORE the transaction — nothing inside it ran.
    expect(lockQuery).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(colorDeleteMany).not.toHaveBeenCalled();
  });

  it('curation gate: retired trait_id → VALIDATION_ERROR (field trait_ids)', async () => {
    mockScenario({ activeTraitIds: [] });

    const result = await updateGalleryRecord_IO(
      makeArgs({ trait_ids: ['trait_retired'] })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('trait_ids');
      }
    }
  });

  it('record not found → GALLERY_RECORD_NOT_FOUND', async () => {
    const { update } = mockScenario({ exists: false });

    const result = await updateGalleryRecord_IO(
      makeArgs({ nail_length: NAIL_LENGTHS.XL })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('foreign record → SAME GALLERY_RECORD_NOT_FOUND (anti-enumeration mask), zero mutations', async () => {
    const { update, colorDeleteMany, traitDeleteMany } = mockScenario({
      owner: OTHER_ACCOUNT_ID,
    });

    const result = await updateGalleryRecord_IO(
      makeArgs({ color_ids: ['color_1'], trait_ids: ['trait_1'] })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
    expect(update).not.toHaveBeenCalled();
    expect(colorDeleteMany).not.toHaveBeenCalled();
    expect(traitDeleteMany).not.toHaveBeenCalled();
  });

  it('missing created_by_account_id → VALIDATION_ERROR', async () => {
    mockDb({});

    const result = await updateGalleryRecord_IO({
      props: { created_by_account_id: '', gallery_record_id: RECORD_ID },
      id: OP_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
  });

  it('P2003 during junction replace (id deleted in TOCTOU window) → VALIDATION_ERROR', async () => {
    const { colorCreateMany } = mockScenario();
    colorCreateMany.mockImplementation(async () => {
      throw Object.assign(new Error('FK violation'), { code: 'P2003' });
    });

    const result = await updateGalleryRecord_IO(
      makeArgs({ color_ids: ['color_1'] })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('color_ids/trait_ids');
      }
    }
  });

  it('P2025 on the final update (record deleted concurrently) → GALLERY_RECORD_NOT_FOUND, not 500', async () => {
    const { update } = mockScenario();
    update.mockImplementation(async () => {
      throw Object.assign(new Error('Record to update not found.'), {
        code: 'P2025',
      });
    });

    const result = await updateGalleryRecord_IO(
      makeArgs({ nail_length: NAIL_LENGTHS.MEDIUM })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_RECORD_NOT_FOUND');
    }
  });

  it('takes the record row lock BEFORE any junction write (serializes concurrent edits)', async () => {
    const { lockQuery, colorDeleteMany, traitDeleteMany } = mockScenario();

    const result = await updateGalleryRecord_IO(
      makeArgs({ color_ids: ['color_1'], trait_ids: ['trait_1'] })
    );

    expect(result.success).toBe(true);
    expect(lockQuery).toHaveBeenCalledTimes(1);
    const lockOrder = lockQuery.mock.invocationCallOrder[0] ?? Infinity;
    expect(lockOrder).toBeLessThan(
      colorDeleteMany.mock.invocationCallOrder[0] ?? -Infinity
    );
    expect(lockOrder).toBeLessThan(
      traitDeleteMany.mock.invocationCallOrder[0] ?? -Infinity
    );
  });

  it('unknown DB throw → DATABASE_ERROR', async () => {
    const { update } = mockScenario();
    update.mockImplementation(async () => {
      throw new Error('connection reset');
    });

    const result = await updateGalleryRecord_IO(
      makeArgs({ nail_length: NAIL_LENGTHS.MEDIUM })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

/**
 * Gallery reference-data unit tests — getActiveColors_IO / getActiveTraits_IO.
 *
 * Locks in the curation-facing dictionary contract:
 *
 *  - both pickers serve ONLY is_active:true entries (retired colors/traits never
 *    reach the client picker — the counterpart of the create/update curation gate);
 *  - getActiveTraits_IO adds the category filter ONLY when a category was passed
 *    (partial filter semantics) and narrows the raw category string;
 *  - DB failure → DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getActiveColors_IO,
  getActiveTraits_IO,
} from './gallery-reference-data.operations';

describe('getActiveColors_IO — active-only color dictionary', () => {
  it('queries is_active:true only and returns the rows', async () => {
    const findMany = vi.fn(async (_arg: unknown) => [
      { id: 'color_1', name: 'Red', hex_code: '#ff0000' },
    ]);
    mockDb({ color: { findMany } });

    const result = await getActiveColors_IO();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        { id: 'color_1', name: 'Red', hex_code: '#ff0000' },
      ]);
    }
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { is_active: boolean };
    };
    expect(arg.where.is_active).toBe(true);
  });

  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      color: {
        findMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await getActiveColors_IO();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

describe('getActiveTraits_IO — active-only trait dictionary + optional category', () => {
  const TRAIT_ROW = {
    id: 'trait_1',
    name: 'French',
    category: 'style',
    icon_url: null,
    is_featured: true,
  };

  it('no category: where carries ONLY is_active (no category key), rows narrowed', async () => {
    const findMany = vi.fn(async (_arg: unknown) => [TRAIT_ROW]);
    mockDb({ trait: { findMany } });

    const result = await getActiveTraits_IO({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([TRAIT_ROW]);
    }
    const arg = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(arg.where.is_active).toBe(true);
    expect('category' in arg.where).toBe(false);
  });

  it('with category: where narrows to that category', async () => {
    const findMany = vi.fn(async (_arg: unknown) => [TRAIT_ROW]);
    mockDb({ trait: { findMany } });

    const result = await getActiveTraits_IO({ category: 'style' });

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as {
      where: { is_active: boolean; category: string };
    };
    expect(arg.where.is_active).toBe(true);
    expect(arg.where.category).toBe('style');
  });

  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      trait: {
        findMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await getActiveTraits_IO({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

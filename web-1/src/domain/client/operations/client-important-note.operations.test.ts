/**
 * „Ważne przed wizytą” — no plan gate, active-pair writes and reads, an empty write clears in
 * any pair state with no existence oracle, whitespace folds to one line.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { __setDb } from '../../../test-utils/setup';
import {
  getClientImportantNote_IO,
  normalizeImportantNote,
  upsertClientImportantNote_IO,
} from './client-important-note.operations';

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000002';

const ACTIVE_WHERE = {
  client_user_id: CLIENT_USER_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  status: 'ACTIVE',
  client_user: { is_active: true },
};

const firstArg = <T>(fn: { mock: { calls: unknown[][] } }): T =>
  fn.mock.calls[0]?.[0] as T;

const upsert = (note: string) =>
  upsertClientImportantNote_IO({
    stylist_account_id: STYLIST_ACCOUNT_ID,
    client_user_id: CLIENT_USER_ID,
    note,
  });

describe('normalizeImportantNote', () => {
  it('folds whitespace into one line and treats blank as null', () => {
    expect(normalizeImportantNote('  uczulenie\n na  aceton ')).toBe(
      'uczulenie na aceton'
    );
    expect(normalizeImportantNote(' \n\t ')).toBeNull();
  });
});

describe('upsertClientImportantNote_IO', () => {
  const setup = (
    options: {
      exists?: boolean;
      status?: string;
      active?: boolean;
      revision?: Date | null;
    } = {}
  ) => {
    const baseline = {
      id: 'pair',
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      status: options.status ?? 'ACTIVE',
      client_user: { is_active: options.active ?? true },
      salon_origin_account_id: null,
      important_note_updated_at: options.revision ?? null,
    };
    const updateMany = vi.fn(async () => ({ count: 1 }));
    __setDb({
      $queryRaw: vi.fn(async () => [{ id: baseline.id }]),
      clientStylistPair: {
        findUnique: vi.fn(async () =>
          options.exists === false ? null : baseline
        ),
        updateMany,
      },
    });
    return { updateMany };
  };
  it('rejects a stale revision without replacing the important note', async () => {
    const { updateMany } = setup({
      revision: new Date('2026-10-01T00:00:00Z'),
    });
    const result = await upsertClientImportantNote_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      note: 'stale',
      expected_updated_at: null,
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'note' },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('writes on an ACTIVE pair and preserves legacy requests without a revision', async () => {
    const { updateMany } = setup();
    const result = await upsert(' Uczulenie na aceton ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.note).toBe('Uczulenie na aceton');
      expect(result.data.updatedAt).not.toBeNull();
    }
    const args = firstArg<{ where: unknown; data: Record<string, unknown> }>(
      updateMany
    );
    expect(args.where).toEqual({ id: 'pair', ...ACTIVE_WHERE });
    expect(args.data['important_note']).toBe('Uczulenie na aceton');
  });
  it('denies nonempty writes to missing, inactive and revoked pairs', async () => {
    for (const options of [
      { exists: false },
      { status: 'REVOKED' },
      { active: false },
    ]) {
      const { updateMany } = setup(options);
      const result = await upsert('Uczulenie');
      expect(result).toMatchObject({
        success: false,
        error: { type: 'CLIENT_UNAUTHORIZED_ACCESS' },
      });
      expect(updateMany).not.toHaveBeenCalled();
    }
  });
  it('clears even a revoked pair with a monotonic tombstone', async () => {
    const future = new Date(Date.now() + 10_000);
    const { updateMany } = setup({ status: 'REVOKED', revision: future });
    const result = await upsertClientImportantNote_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
      note: ' ',
      expected_updated_at: future.toISOString(),
    });
    expect(result).toEqual({
      success: true,
      data: {
        note: null,
        updatedAt: new Date(future.getTime() + 1).toISOString(),
      },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pair',
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: STYLIST_ACCOUNT_ID,
      },
      data: {
        important_note: null,
        important_note_updated_at: new Date(future.getTime() + 1),
      },
    });
  });
  it('clear on a missing pair keeps the no-existence-oracle result', async () => {
    const { updateMany } = setup({ exists: false });
    expect(await upsert(' ')).toEqual({
      success: true,
      data: { note: null, updatedAt: null },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });
  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      clientStylistPair: {
        findUnique: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });
    expect(await upsert('Uczulenie')).toMatchObject({
      success: false,
      error: {
        type: 'DATABASE_ERROR',
        operation: 'upsertClientImportantNote_IO',
      },
    });
  });
});

describe('getClientImportantNote_IO', () => {
  it('reads the active pair with no plan input at all', async () => {
    const findFirst = vi.fn(async () => ({
      important_note: 'Uczulenie na aceton',
      important_note_updated_at: new Date(Date.UTC(2026, 9, 22)),
    }));
    mockDb({ clientStylistPair: { findFirst } });

    const result = await getClientImportantNote_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
    });

    expect(result).toEqual({
      success: true,
      data: {
        note: 'Uczulenie na aceton',
        updatedAt: new Date(Date.UTC(2026, 9, 22)).toISOString(),
      },
    });
    const args = firstArg<{ where: unknown }>(findFirst);
    expect(args.where).toEqual(ACTIVE_WHERE);
  });

  it('foreign or revoked pair → CLIENT_UNAUTHORIZED_ACCESS', async () => {
    mockDb({ clientStylistPair: { findFirst: vi.fn(async () => null) } });
    const result = await getClientImportantNote_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      client_user_id: CLIENT_USER_ID,
    });
    expect(result.success).toBe(false);
  });
});

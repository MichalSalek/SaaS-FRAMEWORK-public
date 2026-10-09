/**
 * deleteClientCrmNote_IO — D4 ownership-only wipe, idempotent, no existence oracle.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { deleteClientCrmNote_IO } from './client-crm-note.operations';

const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
const CLIENT_USER_ID = 'usr_test_0000000000000002';

const OWNERSHIP_WHERE = {
  client_user_id: CLIENT_USER_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
} as const;

const callDelete = () =>
  deleteClientCrmNote_IO({
    stylist_account_id: STYLIST_ACCOUNT_ID,
    client_user_id: CLIENT_USER_ID,
  });

const updateManyArgs = (updateMany: ReturnType<typeof vi.fn>) =>
  updateMany.mock.calls[0]?.[0] as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };

describe('deleteClientCrmNote_IO — D4 ownership-only, no oracle', () => {
  it('count 1 → where is ownership only, returns {note:null, updatedAt:null}', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({ clientStylistPair: { updateMany } });

    const result = await callDelete();

    expect(result).toEqual({
      success: true,
      data: { note: null, updatedAt: null },
    });
    const { where, data } = updateManyArgs(updateMany);
    expect(where).toEqual(OWNERSHIP_WHERE);
    expect(where).not.toHaveProperty('status');
    expect(JSON.stringify(where)).not.toContain('is_active');
    expect(data).toEqual({ crm_note: null, crm_note_updated_at: null });
  });

  it('count 0 → same success payload (idempotent, no oracle)', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    mockDb({ clientStylistPair: { updateMany } });

    const result = await callDelete();

    expect(result).toEqual({
      success: true,
      data: { note: null, updatedAt: null },
    });
    expect(updateManyArgs(updateMany).where).toEqual(OWNERSHIP_WHERE);
  });

  it('DB throw → databaseFailure DATABASE_ERROR', async () => {
    mockDb({
      clientStylistPair: {
        updateMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await callDelete();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        type: 'DATABASE_ERROR',
        operation: 'deleteClientCrmNote_IO',
      });
    }
  });
});

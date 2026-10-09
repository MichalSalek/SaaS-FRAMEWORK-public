/**
 * confirmDeleteSelf_IO — replays are idempotent success but report applied=false.
 *
 * The delete/confirm handler writes USER_DELETE_CONFIRMED only when `applied` is
 * true, so every no-op branch (account already inactive, token already consumed
 * or stale) must say so. A replay that reported applied=true would put a second
 * "deletion confirmed" row into the account's audit trail for a deletion that did
 * not happen on that request.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeUser } from '../../../test-utils/fixtures';
import { createDeleteConfirmToken } from '@app/email-handler/email-delete-confirm.token';
import { confirmDeleteSelf_IO } from './user-mutations.operations';

const USER_ID = 'usr_test_0000000000000001';

describe('confirmDeleteSelf_IO — applied flag on replays', () => {
  it('account already inactive (link clicked again) → success, applied=false, no claim', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: vi.fn(async () =>
          makeUser({ id: USER_ID, is_active: false, deleted_at: new Date() })
        ),
        updateMany,
      },
    });

    const result = await confirmDeleteSelf_IO({
      token: createDeleteConfirmToken(USER_ID, 0),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        confirmed: true,
        userId: USER_ID,
        applied: false,
      });
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('token already consumed (version CAS misses) → success, applied=false', async () => {
    mockDb({
      user: {
        findUnique: vi.fn(async () =>
          makeUser({ id: USER_ID, is_active: true, delete_confirm_version: 1 })
        ),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });

    const result = await confirmDeleteSelf_IO({
      token: createDeleteConfirmToken(USER_ID, 0),
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.applied).toBe(false);
      expect(result.data.confirmed).toBe(true);
    }
  });
});

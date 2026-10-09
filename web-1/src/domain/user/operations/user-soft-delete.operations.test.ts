/**
 * reactivateAccount_IO unit tests — recovery vs admin-ban boundary (§13.1).
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Locks in the security guard (cross-model finding, 2026-07-10):
 * self-service recovery MUST NOT lift an admin ban. The hybrid state
 * soft-delete → admin-ban (deleted_at set, recovery_available=true, disabled_at set)
 * is classified RECOVERABLE by account-state-guard (deleted_at-first), so the
 * reactivate endpoint is reachable — the CAS `WHERE recovery_available=true AND
 * disabled_at=null` is the ONLY thing standing between a banned user and un-banning
 * themselves (the data-block clears disabled_at). updateMany is mocked BEHAVIORALLY
 * (where-clause applied to a fixture row), so dropping the disabled_at condition
 * from the guard fails these tests — not just a literal argument snapshot.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeUser } from '../../../test-utils/fixtures';
import { reactivateAccount_IO } from './user-soft-delete.operations';

const USER_ID = 'usr_test_0000000000000001';
const DELETED_AT = new Date('2026-07-01T00:00:00.000Z');
const DISABLED_AT = new Date('2026-07-05T00:00:00.000Z');

type UpdateManyArg = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

/**
 * Behavioral updateMany stub: applies every WHERE condition against `row`
 * (equality semantics — sufficient for the scalar/null conditions used here)
 * and returns count 1 only on a full match. Mirrors what Postgres would do,
 * so the test exercises the guard, not the call-site literal.
 */
const behavioralUpdateMany = (row: Record<string, unknown>) =>
  vi.fn(async (arg: UpdateManyArg) => ({
    count: Object.entries(arg.where).every(([key, value]) => {
      if (key === 'id') {
        return row.id === value;
      }
      return row[key] === value;
    })
      ? 1
      : 0,
  }));

describe('reactivateAccount_IO — recovery guard vs admin-ban (§13.1)', () => {
  it('clean RECOVERABLE (no ban): reactivates in place', async () => {
    const row = makeUser({
      id: USER_ID,
      is_active: false,
      deleted_at: DELETED_AT,
      recovery_available: true,
      disabled_at: null,
    });
    const updateMany = behavioralUpdateMany(row as Record<string, unknown>);
    mockDb({
      user: {
        updateMany,
        // Fresh post-flip row (client-type user: no stylist_account branch).
        findUnique: vi.fn(async () =>
          makeUser({
            id: USER_ID,
            is_active: true,
            deleted_at: null,
            recovery_available: false,
            disabled_at: null,
          })
        ),
      },
    });

    const result = await reactivateAccount_IO({ id: USER_ID });

    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0]?.[0] as UpdateManyArg;
    // Guard shape: recovery flag AND no active admin ban.
    expect(call.where.recovery_available).toBe(true);
    expect(call.where.disabled_at).toBeNull();
    // Coherent ACTIVE state + delete-confirm token invalidation.
    expect(call.data.is_active).toBe(true);
    expect(call.data.deleted_at).toBeNull();
    expect(call.data.disabled_at).toBeNull();
    expect(call.data.recovery_available).toBe(false);
    expect(call.data.delete_confirm_version).toEqual({ increment: 1 });
  });

  it('SECURITY: soft-deleted THEN admin-banned (hybrid) → ACCOUNT_NOT_RECOVERABLE, ban NOT lifted', async () => {
    const row = makeUser({
      id: USER_ID,
      is_active: false,
      deleted_at: DELETED_AT,
      recovery_available: true,
      // Admin ban landed AFTER the self-delete (disableUser_IO / moderation BAN
      // CAS WHERE disabled_at:null passes on a soft-deleted row).
      disabled_at: DISABLED_AT,
    });
    const updateMany = behavioralUpdateMany(row as Record<string, unknown>);
    mockDb({
      user: {
        updateMany,
        findUnique: vi.fn(async () => row),
      },
    });

    const result = await reactivateAccount_IO({ id: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_RECOVERABLE');
    }
  });

  it('already ACTIVE (recovery_available=false): ACCOUNT_NOT_RECOVERABLE (same envelope — anti-enumeration parity)', async () => {
    const row = makeUser({
      id: USER_ID,
      is_active: true,
      deleted_at: null,
      recovery_available: false,
      disabled_at: null,
    });
    const updateMany = behavioralUpdateMany(row as Record<string, unknown>);
    mockDb({
      user: {
        updateMany,
        findUnique: vi.fn(async () => row),
      },
    });

    const result = await reactivateAccount_IO({ id: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_RECOVERABLE');
    }
  });
});

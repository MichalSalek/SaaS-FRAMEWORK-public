import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
const { close } = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }));
vi.mock('@domain/email/operations/free-email.salon-access', () => ({
  finishFreeForSalonOwners_IO: close,
}));
import { enableUser_IO } from './user-state.operations';
import { reactivateAccount_IO } from './user-soft-delete.operations';
import { cascadeBulkEnableAccountStatus } from '@domain/admin/operations/admin-bulk-cascade.helper';
import { DB_CLIENT } from '@app/db/db.client';
function owner(recovery = false) {
  const row = makeStylistCurrentUser({
    user: {
      id: 'owner',
      is_active: false,
      disabled_at: recovery ? null : new Date(),
      deleted_at: recovery ? new Date() : null,
      recovery_available: recovery,
    },
    account: {
      pricing_plan: 'STUDIO',
      payment_status: 'PAID',
      subscription_status: 'ACTIVE',
      account_status: 'NOT_ACTIVE',
    },
  });
  mockDb({
    user: {
      findUnique: async () => row,
      updateMany: async () => {
        row.is_active = true;
        row.disabled_at = null;
        row.deleted_at = null;
        row.recovery_available = false;
        return { count: 1 };
      },
    },
    stylistAccount: {
      updateMany: async () => {
        if (row.stylist_account) {
          row.stylist_account.account_status = 'ACTIVE';
        }
        return { count: 1 };
      },
    },
  });
  return row;
}
describe('salon owner reactivation preserves Free completion', () => {
  beforeEach(() => vi.clearAllMocks());
  it('unban closes members in the same transaction after owner activation', async () => {
    const row = owner();
    expect((await enableUser_IO(row)).success).toBe(true);
    expect(row.is_active).toBe(true);
    expect(row.stylist_account?.account_status).toBe('ACTIVE');
    expect(close).toHaveBeenCalledWith(expect.anything(), ['owner']);
  });
  it('Model A recovery closes members after restoring paid salon visibility', async () => {
    const row = owner(true);
    expect((await reactivateAccount_IO({ id: row.id })).success).toBe(true);
    expect(close).toHaveBeenCalledWith(expect.anything(), ['owner']);
  });
  it('bulk owner activation uses the common activation helper', async () => {
    const row = owner();
    row.is_active = true;
    row.disabled_at = null;
    await cascadeBulkEnableAccountStatus(DB_CLIENT.use, ['owner']);
    expect(close).toHaveBeenCalledWith(expect.anything(), ['owner']);
  });
  it('unbanning a Free account does not trigger salon access completion', async () => {
    const row = owner();
    if (row.stylist_account) {
      row.stylist_account.pricing_plan = 'FREE';
      row.stylist_account.subscription_status = null;
    }
    expect((await enableUser_IO(row)).success).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });
});

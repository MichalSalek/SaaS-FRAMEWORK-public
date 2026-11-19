// Shared mock world of the salon access resolver tests (behaviour + exact predicates).
import { vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';

export const owner = {
  account_id: 'salon',
  pricing_plan: 'STUDIO',
  subscription_status: 'ACTIVE',
  payment_status: 'PAID',
  account_status: 'ACTIVE',
  account_expiration_date: null as Date | null,
  staff_members: [
    {
      user: {
        stylist_account: { account_id: 'seed', account_status: 'ACTIVE' },
      },
    },
    {
      user: {
        stylist_account: { account_id: 'colleague', account_status: 'ACTIVE' },
      },
    },
  ],
};
export function setup({
  direct = false,
  salons = [owner],
  seeds = [{ stylist_account_id: 'seed' }],
  existing = null,
}: {
  direct?: boolean;
  salons?: (typeof owner)[];
  seeds?: { stylist_account_id: string }[];
  existing?: { id: string; status: string; revoked_by: string | null } | null;
} = {}) {
  const findFirst = vi.fn(async () => (direct ? { id: 'direct' } : null));
  const findMany = vi.fn(async () => seeds);
  const salonFind = vi.fn(async (_args: unknown) => salons);
  const upsert = vi.fn(async () => ({ id: 'derived' }));
  mockDb({
    clientStylistPair: {
      findFirst,
      findMany,
      findUnique: vi.fn(async () => existing),
      upsert,
    },
    stylistAccount: { findMany: salonFind },
  });
  return { findFirst, findMany, salonFind, upsert };
}

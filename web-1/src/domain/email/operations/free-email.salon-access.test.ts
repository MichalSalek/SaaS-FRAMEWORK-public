import { describe, expect, it } from 'vitest';
import { DB_CLIENT } from '@app/db/db.client';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  finishFreeForSalonAccess_IO,
  finishFreeForSalonOwners_IO,
} from './free-email.salon-access';
import { resolveFreeEmail, type FreeEmailState } from './free-email.resolver';

const now = new Date();
const member = (acceptedAt: Date | null = now) => ({
  id: 'membership',
  user_id: 'stylist',
  stylist_account_id: 'salon',
  is_active: true,
  accepted_at: acceptedAt,
  stylist_account: {
    account_id: 'salon',
    created_by_user_id: 'owner',
    business_name: 'Salon',
    salon_profile_name: null,
    display_name: null,
    pricing_plan: 'STUDIO',
    subscription_status: 'ACTIVE',
    account_status: 'ACTIVE',
    account_expiration_date: null as Date | null,
    created_by_user: { is_active: true, disabled_at: null as Date | null },
  },
});
const enrollment = () => ({
  id: 'enrollment',
  userId: 'stylist',
  accountId: 'account',
  cohort: 'new',
  status: 'active',
  startedAt: new Date(now.getTime() - 86400000),
  finishReason: null as string | null,
});
/** Small query interpreter applies the production Prisma predicates to fixture rows. */
function matches(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object') {
    return value === condition;
  }
  if (Array.isArray(condition)) {
    return false;
  }
  return Object.entries(condition).every(([key, expected]) => {
    if (key === 'in') {
      return Array.isArray(expected) && expected.includes(value);
    }
    if (key === 'not') {
      return value !== expected;
    }
    if (key === 'gt') {
      return (
        value instanceof Date && expected instanceof Date && value > expected
      );
    }
    if (key === 'OR') {
      return (
        Array.isArray(expected) && expected.some(item => matches(value, item))
      );
    }
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    return matches(Reflect.get(value, key), expected);
  });
}
function install(row = member()) {
  const record = enrollment();
  mockDb({
    staffMember: {
      findMany: async ({ where }: { where: unknown }) =>
        matches(row, where) ? [row] : [],
    },
    freeEmailEnrollment: {
      updateMany: async ({
        where,
        data,
      }: {
        where: unknown;
        data: { status: string; finishReason: string };
      }) => {
        if (!matches(record, where)) {
          return { count: 0 };
        }
        Object.assign(record, data);
        return { count: 1 };
      },
    },
  });
  return { row, record };
}

describe('permanent Free completion after actual paid salon access', () => {
  it('does not replay when an accepted paid membership is revoked before the next sweep', async () => {
    const { row, record } = install();
    await finishFreeForSalonAccess_IO(DB_CLIENT.use, 'salon', 'stylist', now);
    expect(record).toMatchObject({
      status: 'finished',
      finishReason: 'access_changed',
    });
    row.is_active = false;
    const state: FreeEmailState = {
      active: true,
      effectiveFree: true,
      hasTrialHistory: false,
      hasPaidHistory: false,
      checkoutActive: false,
      tipsEnabled: true,
      deliveryBlocked: false,
      excluded: false,
      visiblePhotoCount: 0,
      visiblePinnedCount: 0,
      acceptedPairCount: 0,
      pendingPairCount: 0,
    };
    expect(resolveFreeEmail(record, state, [], now)).toEqual({
      kind: 'skip',
      reason: 'closed',
    });
  });
  it('captures a later salon upgrade for members who already accepted', async () => {
    const { row, record } = install();
    row.stylist_account.pricing_plan = 'PRO';
    await finishFreeForSalonOwners_IO(DB_CLIENT.use, ['owner'], now);
    expect(record.status).toBe('active');
    row.stylist_account.pricing_plan = 'STUDIO';
    await finishFreeForSalonOwners_IO(DB_CLIENT.use, ['owner'], now);
    expect(record.status).toBe('finished');
  });
  it.each(['PRO', 'FREE', 'PRO_PLUS'])(
    'does not close for a %s salon',
    async plan => {
      const { row, record } = install();
      row.stylist_account.pricing_plan = plan;
      await finishFreeForSalonAccess_IO(DB_CLIENT.use, 'salon', 'stylist', now);
      expect(record.status).toBe('active');
    }
  );
  it.each(['TRIALING', 'PAST_DUE', 'CANCELED', 'INCOMPLETE'])(
    'does not close for %s subscription',
    async status => {
      const { row, record } = install();
      row.stylist_account.subscription_status = status;
      await finishFreeForSalonAccess_IO(DB_CLIENT.use, 'salon', 'stylist', now);
      expect(record.status).toBe('active');
    }
  );
  it('does not close for expired, inactive, disabled or unaccepted access', async () => {
    for (const change of [
      (row: ReturnType<typeof member>) => {
        row.stylist_account.account_expiration_date = new Date(0);
      },
      (row: ReturnType<typeof member>) => {
        row.stylist_account.account_status = 'EXPIRED';
      },
      (row: ReturnType<typeof member>) => {
        row.stylist_account.created_by_user.disabled_at = now;
      },
      (row: ReturnType<typeof member>) => {
        row.stylist_account.created_by_user.is_active = false;
      },
      (row: ReturnType<typeof member>) => {
        row.is_active = false;
      },
      (row: ReturnType<typeof member>) => {
        row.accepted_at = null;
      },
    ]) {
      const { row, record } = install();
      change(row);
      await finishFreeForSalonAccess_IO(DB_CLIENT.use, 'salon', 'stylist', now);
      expect(record.status).toBe('active');
    }
  });
  it('never touches a different member or owner scope', async () => {
    const { record } = install();
    await finishFreeForSalonAccess_IO(
      DB_CLIENT.use,
      'salon',
      'someone-else',
      now
    );
    await finishFreeForSalonOwners_IO(DB_CLIENT.use, ['other-owner'], now);
    expect(record.status).toBe('active');
  });
});

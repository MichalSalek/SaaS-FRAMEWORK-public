/**
 * getAllStaffMembers_IO / getStaffMemberById_IO — the roster must show EXACTLY the seats that count toward the plan
 * limit (see liveStaffSeatWhere in salon-staff.utils.ts).
 *
 * `findMany` / `findFirst` are mocked BEHAVIORALLY (the WHERE is really applied to rows), so removing the account
 * liveness condition from the query fails the test. Without it the list and the quota diverged: the owner saw 9 of 9
 * members, one of whom could no longer log in, and the seat could not be freed.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getAllStaffMembers_IO,
  getStaffMemberById_IO,
} from './salon-staff-query.operations';

const ACCOUNT_ID = 'sa_test_0000000000000001';

type Row = {
  id: string;
  stylist_account_id: string;
  user_id: string;
  role: 'EMPLOYEE';
  permissions: string[];
  invited_at: Date;
  accepted_at: Date | null;
  is_active: boolean;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    is_active: boolean;
    disabled_at: Date | null;
  };
};

const makeRow = (
  id: string,
  userState: { is_active: boolean; disabled_at: Date | null },
  acceptedAt: Date | null = new Date('2026-08-02T10:00:00.000Z')
): Row => ({
  id,
  stylist_account_id: ACCOUNT_ID,
  user_id: `usr_${id}`,
  role: 'EMPLOYEE',
  permissions: ['GALLERY_VIEW'],
  invited_at: new Date('2026-08-01T10:00:00.000Z'),
  accepted_at: acceptedAt,
  is_active: true,
  user: {
    id: `usr_${id}`,
    name: 'Ala',
    email: `${id}@example.com`,
    image: 'https://cdn.example/ala.jpg',
    ...userState,
  },
});

const ALIVE = makeRow('stf_alive', { is_active: true, disabled_at: null });
const DELETED = makeRow('stf_deleted', { is_active: false, disabled_at: null });
const BANNED = makeRow('stf_banned', {
  // D1: ban flips User.is_active (soft-delete window / admin ban) — mask keys off this flag.
  is_active: false,
  disabled_at: new Date('2026-07-05T00:00:00.000Z'),
});
const PENDING = makeRow(
  'stf_pending',
  { is_active: true, disabled_at: null },
  null
);

const matches = (row: Row, where: Record<string, unknown>): boolean => {
  const { user: userWhere, ...scalars } = where as {
    user?: Record<string, unknown>;
  } & Record<string, unknown>;
  const scalarsMatch = Object.entries(scalars).every(
    ([key, value]) => (row as unknown as Record<string, unknown>)[key] === value
  );
  if (!scalarsMatch) {
    return false;
  }
  if (!userWhere) {
    return true;
  }
  return Object.entries(userWhere).every(
    ([key, value]) =>
      (row.user as unknown as Record<string, unknown>)[key] === value
  );
};

const mockRoster = (rows: Row[]) => {
  const findMany = vi.fn(async (arg: { where: Record<string, unknown> }) =>
    rows.filter(row => matches(row, arg.where))
  );
  const findFirst = vi.fn(
    async (arg: { where: Record<string, unknown> }) =>
      rows.find(row => matches(row, arg.where)) ?? null
  );
  mockDb({
    salonInvitation: { findMany: async () => [], findFirst: async () => null },
    user: { findUnique: async () => null },
    staffMember: { findMany, findFirst },
  });
  return { findMany, findFirst };
};

const userSelect = (fn: ReturnType<typeof vi.fn>) =>
  (
    fn.mock.calls[0]?.[0] as {
      include: {
        user: { select: { is_active?: boolean; stylist_account?: unknown } };
      };
    }
  ).include.user.select;

describe('getAllStaffMembers_IO — lista pokazuje KAŻDE zajęte miejsce', () => {
  it('pokazuje także członkinie ze skasowanym i zbanowanym kontem', async () => {
    // This test used to encode the opposite: dead accounts were HIDDEN so they would not hold a paid seat. That version
    // freed the slot while the membership row still existed, so after the account returned the salon stayed permanently
    // over its limit (see liveStaffSeatWhere). Since the seat is occupied it MUST be visible, or the owner cannot free it.
    const { findMany } = mockRoster([ALIVE, DELETED, BANNED]);

    const result = await getAllStaffMembers_IO({
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(true);
    expect(userSelect(findMany).is_active).toBe(true);
    expect(userSelect(findMany).stylist_account).toEqual({
      select: expect.objectContaining({
        display_name: true,
        business_name: true,
      }),
    });
    if (result.success) {
      expect(result.data.staff.map(member => member.id).sort()).toEqual(
        [ALIVE.id, DELETED.id, BANNED.id].sort()
      );
      const byId = Object.fromEntries(
        result.data.staff.map(member => [member.id, member])
      );
      expect(byId[ALIVE.id]).toEqual(
        expect.objectContaining({
          user_inactive: false,
          user: expect.objectContaining({
            name: 'Ala',
            email: `${ALIVE.id}@example.com`,
            image: 'https://cdn.example/ala.jpg',
          }),
        })
      );
      expect(byId[DELETED.id]).toEqual(
        expect.objectContaining({
          user_inactive: true,
          user: expect.objectContaining({
            name: null,
            email: '',
            image: null,
          }),
        })
      );
      expect(byId[BANNED.id]).toEqual(
        expect.objectContaining({
          user_inactive: true,
          user: expect.objectContaining({
            name: null,
            email: '',
            image: null,
          }),
        })
      );
    }
  });
});

describe('getStaffMemberById_IO — detal spójny z listą', () => {
  it('zwraca żywą członkinię', async () => {
    const { findFirst } = mockRoster([ALIVE, DELETED]);

    const result = await getStaffMemberById_IO({
      staffId: ALIVE.id,
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(true);
    expect(userSelect(findFirst).is_active).toBe(true);
    expect(userSelect(findFirst).stylist_account).toEqual({
      select: expect.objectContaining({
        display_name: true,
        business_name: true,
      }),
    });
    if (result.success) {
      expect(result.data.staff).toEqual(
        expect.objectContaining({
          user_inactive: false,
          user: expect.objectContaining({
            name: 'Ala',
            email: `${ALIVE.id}@example.com`,
            image: 'https://cdn.example/ala.jpg',
          }),
        })
      );
    }
  });

  it('martwe konto jest w detalu, bo jest na liście i zajmuje miejsce', async () => {
    // Detail and the list must share one predicate. Both used to filter account
    // liveness; now neither does. A split would be worse than either choice
    // („widzę wiersz, nie mogę go otworzyć").
    const { findFirst } = mockRoster([ALIVE, DELETED]);

    const result = await getStaffMemberById_IO({
      staffId: DELETED.id,
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(true);
    expect(userSelect(findFirst).is_active).toBe(true);
    if (result.success) {
      expect(result.data.staff).toEqual(
        expect.objectContaining({
          id: DELETED.id,
          user_id: DELETED.user_id,
          user_inactive: true,
          user: expect.objectContaining({
            name: null,
            email: '',
            image: null,
          }),
        })
      );
    }
  });
});

describe('pending invite — roster does not reveal who owns the e-mail', () => {
  it('list and detail return no name/image before acceptance, e-mail kept', async () => {
    mockRoster([ALIVE, PENDING]);

    const list = await getAllStaffMembers_IO({
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });
    const detail = await getStaffMemberById_IO({
      staffId: PENDING.id,
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    const pendingIdentity = {
      id: PENDING.user_id,
      name: null,
      email: `${PENDING.id}@example.com`,
      image: null,
    };
    expect(list.success).toBe(true);
    if (list.success) {
      const pending = list.data.staff.find(member => member.id === PENDING.id);
      expect(pending?.user_inactive).toBe(false);
      expect(pending?.user).toEqual(pendingIdentity);
    }
    expect(detail.success).toBe(true);
    if (detail.success) {
      expect(detail.data.staff.user).toEqual(pendingIdentity);
    }
  });
});

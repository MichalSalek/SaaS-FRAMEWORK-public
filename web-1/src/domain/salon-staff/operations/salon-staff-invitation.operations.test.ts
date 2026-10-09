/**
 * Invitee side of the salon-team invitation (getMyStaffInvitations_IO +
 * respondToStaffInvitation_IO).
 *
 * The DB is an in-memory store whose updateMany / deleteMany / findFirst /
 * findMany APPLY the WHERE the operation sends (scalars + the nested owner
 * liveness filter), one call at a time, the way a row lock serializes them in
 * Postgres. Dropping a predicate from the code (user_id, accepted_at null, owner
 * liveness) therefore changes the outcome and fails a test; nothing here
 * snapshots call arguments.
 */

import { describe, it, expect } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getMyStaffInvitations_IO,
  respondToStaffInvitation_IO,
} from './salon-staff-invitation.operations';

const INVITEE = 'usr_invitee_000000000001';
const STRANGER = 'usr_stranger_00000000001';

type Owner = {
  name: string | null;
  image: string | null;
  is_active: boolean;
  disabled_at: Date | null;
};

type Row = {
  id: string;
  user_id: string;
  stylist_account_id: string;
  role: 'EMPLOYEE';
  is_active: boolean;
  invited_at: Date;
  accepted_at: Date | null;
  stylist_account: {
    display_name: string | null;
    business_name: string | null;
    avatar_url: string | null;
    created_by_user: Owner;
  };
};

const liveOwner = (): Owner => ({
  name: 'Ola',
  image: 'https://cdn.example/ola.jpg',
  is_active: true,
  disabled_at: null,
});

const row = (overrides: Partial<Row> = {}): Row => ({
  id: 'stf_0000000000000000001',
  user_id: INVITEE,
  stylist_account_id: 'sa_00000000000000000001',
  role: 'EMPLOYEE',
  is_active: true,
  invited_at: new Date('2026-09-20T10:00:00.000Z'),
  accepted_at: null,
  stylist_account: {
    display_name: 'Ola Nails',
    business_name: 'Studio Ola',
    avatar_url: null,
    created_by_user: liveOwner(),
  },
  ...overrides,
});

type Where = Record<string, unknown> & {
  stylist_account?: { created_by_user?: Record<string, unknown> };
};

const matches = (r: Row, where: Where): boolean =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'stylist_account') {
      const ownerWhere =
        (value as { created_by_user?: Record<string, unknown> })
          .created_by_user ?? {};
      return Object.entries(ownerWhere).every(
        ([k, v]) =>
          (r.stylist_account.created_by_user as Record<string, unknown>)[k] ===
          v
      );
    }
    return (r as unknown as Record<string, unknown>)[key] === value;
  });

/** Installs the store as DB_CLIENT.use and returns it plus a write counter. */
const installStore = (initial: Row[]) => {
  const store = { rows: initial.map(r => ({ ...r })), acceptWrites: 0 };
  // Each method yields once before touching the store, so Promise.all really
  // interleaves two requests at the statement boundary.
  const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
  mockDb({
    staffMember: {
      findMany: async (arg: { where: Where }) => {
        await tick();
        return store.rows.filter(r => matches(r, arg.where));
      },
      findFirst: async (arg: { where: Where }) => {
        await tick();
        return store.rows.find(r => matches(r, arg.where)) ?? null;
      },
      updateMany: async (arg: {
        where: Where;
        data: { accepted_at: Date };
      }) => {
        await tick();
        const hit = store.rows.filter(r => matches(r, arg.where));
        hit.forEach(r => {
          r.accepted_at = arg.data.accepted_at;
        });
        store.acceptWrites += hit.length;
        return { count: hit.length };
      },
      deleteMany: async (arg: { where: Where }) => {
        await tick();
        const before = store.rows.length;
        store.rows = store.rows.filter(r => !matches(r, arg.where));
        return { count: before - store.rows.length };
      },
    },
  });
  return store;
};

describe('getMyStaffInvitations_IO', () => {
  it('lists only the caller’s pending invitations from a live salon', async () => {
    installStore([
      row({ id: 'stf_pending' }),
      row({ id: 'stf_accepted', accepted_at: new Date() }),
      row({ id: 'stf_foreign', user_id: STRANGER }),
      row({ id: 'stf_inactive', is_active: false }),
      row({
        id: 'stf_banned_owner',
        stylist_account: {
          ...row().stylist_account,
          created_by_user: { ...liveOwner(), is_active: false },
        },
      }),
    ]);

    const result = await getMyStaffInvitations_IO({ userId: INVITEE });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.invitations).toEqual([
      {
        staff_member_id: 'stf_pending',
        salon_account_id: 'sa_00000000000000000001',
        inviter_name: 'Ola Nails',
        salon_name: 'Studio Ola',
        owner_avatar_url: 'https://cdn.example/ola.jpg',
        role: 'EMPLOYEE',
        invited_at: '2026-09-20T10:00:00.000Z',
      },
    ]);
  });
});

describe('respondToStaffInvitation_IO — ACCEPT', () => {
  it('writes accepted_at for the invitee', async () => {
    const store = installStore([row()]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_0000000000000000001',
      response: 'ACCEPT',
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.status).toBe('ACCEPTED');
    expect(store.rows[0]?.accepted_at).not.toBeNull();
    expect(result.data.accepted_at).toBe(
      store.rows[0]?.accepted_at?.toISOString()
    );
  });

  it('is idempotent: a second ACCEPT is the same success and keeps the first date', async () => {
    const firstAccept = new Date('2026-09-21T08:00:00.000Z');
    const store = installStore([row({ accepted_at: firstAccept })]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_0000000000000000001',
      response: 'ACCEPT',
    });

    expect(result).toEqual({
      success: true,
      data: {
        staff_member_id: 'stf_0000000000000000001',
        status: 'ACCEPTED',
        accepted_at: firstAccept.toISOString(),
        applied: false,
      },
    });
    expect(store.acceptWrites).toBe(0);
  });

  it('someone else’s invitation → SALON_STAFF_NOT_FOUND and the row stays untouched', async () => {
    const store = installStore([row()]);

    const result = await respondToStaffInvitation_IO({
      userId: STRANGER,
      staffMemberId: 'stf_0000000000000000001',
      response: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('SALON_STAFF_NOT_FOUND');
    expect(store.rows[0]?.accepted_at).toBeNull();
  });

  it('a nonexistent id → the same SALON_STAFF_NOT_FOUND (no oracle)', async () => {
    installStore([row()]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_does_not_exist',
      response: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('SALON_STAFF_NOT_FOUND');
  });

  it('an invitation from a banned or deleted owner cannot be accepted', async () => {
    const store = installStore([
      row({
        stylist_account: {
          ...row().stylist_account,
          created_by_user: { ...liveOwner(), disabled_at: new Date() },
        },
      }),
    ]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_0000000000000000001',
      response: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    expect(store.rows[0]?.accepted_at).toBeNull();
  });
});

describe('respondToStaffInvitation_IO — DECLINE', () => {
  it('removes the pending membership (hard delete, seat freed)', async () => {
    const store = installStore([row(), row({ id: 'stf_other_salon' })]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_0000000000000000001',
      response: 'DECLINE',
    });

    expect(result).toEqual({
      success: true,
      data: {
        staff_member_id: 'stf_0000000000000000001',
        status: 'DECLINED',
        accepted_at: null,
        applied: true,
      },
    });
    expect(store.rows.map(r => r.id)).toEqual(['stf_other_salon']);
  });

  it('is idempotent: declining an already removed invitation is the same success', async () => {
    installStore([]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_0000000000000000001',
      response: 'DECLINE',
    });

    expect(result.success).toBe(true);
  });

  it('someone else’s invitation is never deleted', async () => {
    const store = installStore([row()]);

    const result = await respondToStaffInvitation_IO({
      userId: STRANGER,
      staffMemberId: 'stf_0000000000000000001',
      response: 'DECLINE',
    });

    expect(store.rows).toHaveLength(1);
    // A foreign no-op must not be audited as "declined".
    expect(result.success && result.data.applied).toBe(false);
  });

  it('an accepted membership is not an invitation any more → SALON_STAFF_NOT_FOUND, row kept', async () => {
    const store = installStore([row({ accepted_at: new Date() })]);

    const result = await respondToStaffInvitation_IO({
      userId: INVITEE,
      staffMemberId: 'stf_0000000000000000001',
      response: 'DECLINE',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.type).toBe('SALON_STAFF_NOT_FOUND');
    expect(store.rows).toHaveLength(1);
  });
});

describe('respondToStaffInvitation_IO — concurrency', () => {
  it('two ACCEPTs at once: both succeed, accepted_at written exactly once', async () => {
    const store = installStore([row()]);
    const accept = () =>
      respondToStaffInvitation_IO({
        userId: INVITEE,
        staffMemberId: 'stf_0000000000000000001',
        response: 'ACCEPT',
      });

    const [a, b] = await Promise.all([accept(), accept()]);

    expect(a.success && b.success).toBe(true);
    expect(store.acceptWrites).toBe(1);
    if (!a.success || !b.success) {
      return;
    }
    expect(a.data.accepted_at).toBe(b.data.accepted_at);
  });

  it('ACCEPT and DECLINE at once: one wins, the loser gets NOT_FOUND, the state is consistent', async () => {
    const store = installStore([row()]);

    const [accepted, declined] = await Promise.all([
      respondToStaffInvitation_IO({
        userId: INVITEE,
        staffMemberId: 'stf_0000000000000000001',
        response: 'ACCEPT',
      }),
      respondToStaffInvitation_IO({
        userId: INVITEE,
        staffMemberId: 'stf_0000000000000000001',
        response: 'DECLINE',
      }),
    ]);

    // The ACCEPT statement reached the store first, so the membership stays and
    // is accepted; the DECLINE predicate (accepted_at null) no longer matches.
    expect(accepted.success).toBe(true);
    expect(declined.success).toBe(false);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.accepted_at).not.toBeNull();
  });

  it('DECLINE first, then ACCEPT: the membership is gone and ACCEPT gets NOT_FOUND', async () => {
    const store = installStore([row()]);

    const [declined, accepted] = await Promise.all([
      respondToStaffInvitation_IO({
        userId: INVITEE,
        staffMemberId: 'stf_0000000000000000001',
        response: 'DECLINE',
      }),
      respondToStaffInvitation_IO({
        userId: INVITEE,
        staffMemberId: 'stf_0000000000000000001',
        response: 'ACCEPT',
      }),
    ]);

    expect(declined.success).toBe(true);
    expect(accepted.success).toBe(false);
    expect(store.rows).toHaveLength(0);
  });
});

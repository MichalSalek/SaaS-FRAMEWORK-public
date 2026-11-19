/**
 * Pruning the demo salon roster (pruneDemoSalonRoster_IO).
 * The seed keeps only DEMO_SALON_STAFF in Ania's salon. Tests and manual
 * reviews added people, salon-derived pairs and staff sessions through the
 * real invite flow, and find-or-create left them, so they showed up on
 * screenshots. The database double filters rows the way Postgres does, so
 * the test checks what remains, not the query text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Membership = { stylist_account_id: string; user_id: string };
type Invitation = { salon_account_id: string; email: string };
type Pair = {
  id: string;
  stylist_account_id: string;
  salon_origin_account_id: string | null;
};
type Session = { id: string; stylist_account_id: string | null };

const { state, db } = vi.hoisted(() => {
  const state = {
    memberships: [] as Membership[],
    invitations: [] as Invitation[],
    pairs: [] as Pair[],
    sessions: [] as Session[],
  };
  const remove = <T>(
    key: 'memberships' | 'invitations' | 'pairs' | 'sessions',
    predicate: (row: T) => boolean
  ): { count: number } => {
    const rows = state[key] as unknown as T[];
    const kept = rows.filter(row => !predicate(row));
    const count = rows.length - kept.length;
    (state[key] as unknown as T[]) = kept;
    return { count };
  };
  const db = {
    use: {
      staffMember: {
        deleteMany: vi.fn(
          async ({
            where,
          }: {
            where: { stylist_account_id: string; user_id: { notIn: string[] } };
          }) =>
            remove<Membership>(
              'memberships',
              row =>
                row.stylist_account_id === where.stylist_account_id &&
                !where.user_id.notIn.includes(row.user_id)
            )
        ),
      },
      salonInvitation: {
        deleteMany: vi.fn(
          async ({ where }: { where: { salon_account_id: string } }) =>
            remove<Invitation>(
              'invitations',
              row => row.salon_account_id === where.salon_account_id
            )
        ),
      },
      clientStylistPair: {
        deleteMany: vi.fn(
          async ({ where }: { where: { salon_origin_account_id: string } }) =>
            remove<Pair>(
              'pairs',
              row =>
                row.salon_origin_account_id === where.salon_origin_account_id
            )
        ),
      },
      sessionContainer: {
        deleteMany: vi.fn(
          async ({
            where,
          }: {
            where: { stylist_account_id: { in: string[] } };
          }) =>
            remove<Session>(
              'sessions',
              row =>
                row.stylist_account_id !== null &&
                where.stylist_account_id.in.includes(row.stylist_account_id)
            )
        ),
      },
    },
  };
  return { state, db };
});

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));

import { pruneDemoSalonRoster_IO } from './demo-content-seeding.cleanup';

const OWNER = 'acc-ania';
const OTHER_SALON = 'acc-other-salon';

beforeEach(() => {
  vi.clearAllMocks();
  state.memberships = [
    { stylist_account_id: OWNER, user_id: 'user-marta' },
    { stylist_account_id: OWNER, user_id: 'user-kasia' },
    { stylist_account_id: OWNER, user_id: 'user-test-stylist' },
    { stylist_account_id: OWNER, user_id: 'user-joanna' },
    { stylist_account_id: OTHER_SALON, user_id: 'user-test-stylist' },
  ];
  state.invitations = [
    { salon_account_id: OWNER, email: 'salon-job-new@example.com' },
    { salon_account_id: OTHER_SALON, email: 'someone@example.com' },
  ];
  state.pairs = [
    {
      id: 'pair-ania',
      stylist_account_id: OWNER,
      salon_origin_account_id: null,
    },
    {
      id: 'pair-marta-derived',
      stylist_account_id: 'acc-marta',
      salon_origin_account_id: OWNER,
    },
    {
      id: 'pair-other-derived',
      stylist_account_id: 'acc-x',
      salon_origin_account_id: OTHER_SALON,
    },
  ];
  state.sessions = [
    { id: 'session-ania', stylist_account_id: OWNER },
    { id: 'session-marta', stylist_account_id: 'acc-marta' },
    { id: 'session-draft', stylist_account_id: null },
  ];
});

describe('pruneDemoSalonRoster_IO', () => {
  it('zostawia w salonie demo tylko personel z seeda i nie rusza innych salonów', async () => {
    const results: string[] = [];
    await pruneDemoSalonRoster_IO({
      ownerAccountId: OWNER,
      staffUserIds: ['user-marta', 'user-kasia'],
      staffAccountIds: ['acc-marta', 'acc-kasia'],
      results,
    });

    expect(state.memberships).toEqual([
      { stylist_account_id: OWNER, user_id: 'user-marta' },
      { stylist_account_id: OWNER, user_id: 'user-kasia' },
      { stylist_account_id: OTHER_SALON, user_id: 'user-test-stylist' },
    ]);
    expect(state.invitations.map(i => i.salon_account_id)).toEqual([
      OTHER_SALON,
    ]);
    expect(state.pairs.map(p => p.id)).toEqual([
      'pair-ania',
      'pair-other-derived',
    ]);
    expect(state.sessions.map(s => s.id)).toEqual([
      'session-ania',
      'session-draft',
    ]);
    expect(results).toEqual([
      'Demo salon roster pruned (memberships 2, invitations 1, salon-derived pairs 1, staff sessions 1)',
    ]);
  });

  it('czysty stan po seedzie niczego nie kasuje i nic nie raportuje', async () => {
    const first: string[] = [];
    const args = {
      ownerAccountId: OWNER,
      staffUserIds: ['user-marta', 'user-kasia'],
      staffAccountIds: ['acc-marta', 'acc-kasia'],
    };
    await pruneDemoSalonRoster_IO({ ...args, results: first });
    const second: string[] = [];
    await pruneDemoSalonRoster_IO({ ...args, results: second });
    expect(second).toEqual([]);
  });

  it('bez kont personelu nie kasuje żadnej sesji', async () => {
    await pruneDemoSalonRoster_IO({
      ownerAccountId: OWNER,
      staffUserIds: [],
      staffAccountIds: [],
      results: [],
    });
    expect(db.use.sessionContainer.deleteMany).not.toHaveBeenCalled();
    expect(state.sessions).toHaveLength(3);
  });
});

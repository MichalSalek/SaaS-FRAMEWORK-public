/**
 * ADMIN USER-SEARCH unit tests (finding F2).
 *
 * `_count: { sessions: { where: ... } }` inside findMany compiled to an
 * uncorrelated aggregate over the whole "Session" table (GROUP BY with no
 * filter to the page ids). The active-session count now comes from a
 * correlated LATERAL limited to the users on the current page.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  adminGetUsersPaginated_IO,
  buildUsersPrimaryOrder,
} from './admin-user-search.operations';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const adminCaller = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});

const userRow = (id: string) => ({
  id,
  email: `${id}@test.local`,
  emailVerified: true,
  name: 'Test',
  account_type: 'STYLIST',
  role_id: SystemRoleId.STYLIST_ROLE,
  is_active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  last_login_at: null,
  notifications_enabled: true,
  stylist_account: null,
  client_account: null,
});

const none = async () => [];
/** Every model the per-page stats read, answering "nothing". */
const statsStubs = (): Record<
  string,
  Record<string, (...args: never[]) => unknown>
> => ({
  galleryRecord: { groupBy: none },
  clientStylistPair: { findMany: none },
  sessionContainer: { groupBy: none },
  supportThread: { groupBy: none },
  pushSubscription: { groupBy: none },
  staffMember: { findMany: none },
  stylistClientMessage: { groupBy: none },
});

describe('adminGetUsersPaginated_IO — licznik aktywnych sesji', () => {
  it('nie selektuje relacyjnego _count i mapuje licznik z LATERAL-a', async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      userRow('usr_a_000000000000000001'),
      userRow('usr_b_000000000000000002'),
    ]);
    const queryRaw = vi.fn(async () => [
      { user_id: 'usr_a_000000000000000001', active_sessions: 3 },
      // usr_b has no row: a user with no active session.
    ]);
    mockDb({
      ...statsStubs(),
      user: { findMany },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: {},
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const selectArg = (
      findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    ).select;
    expect(selectArg).not.toHaveProperty('_count');
    expect(result.data.records[0]?._count).toEqual({ sessions: 3 });
    expect(result.data.records[1]?._count).toEqual({ sessions: 0 });
  });

  it('pusta strona → zero zapytań o sesje', async () => {
    const queryRaw = vi.fn(async () => []);
    mockDb({
      ...statsStubs(),
      user: { findMany: async () => [] },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: {},
    });

    expect(result.success).toBe(true);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('adminGetUsersPaginated_IO — zapytania kafli pulpitu', () => {
  it('created_from i is_active trafiają do where tak jak w licznikach', async () => {
    const findMany = vi.fn(async (_args: unknown) => []);
    mockDb({
      ...statsStubs(),
      user: { findMany },
      $queryRaw: rawStub(vi.fn(async () => [])),
    });

    const result = await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: { created_from: '2026-10-10', is_active: false },
    });

    expect(result.success).toBe(true);
    const whereArg = (
      findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    expect(whereArg['createdAt']).toEqual({
      gte: new Date('2026-10-10T00:00:00.000Z'),
    });
    expect(whereArg['is_active']).toBe(false);
  });
});

describe('adminGetUsersPaginated_IO — sortowanie', () => {
  it.each([
    ['created_at', { createdAt: 'asc' }],
    ['last_login_at', { last_login_at: { sort: 'asc', nulls: 'last' } }],
    ['photos', { stylist_account: { gallery_record: { _count: 'asc' } } }],
    [
      'city',
      { stylist_account: { address_city: { sort: 'asc', nulls: 'last' } } },
    ],
  ] as const)('%s → pierwszy klucz orderBy', (sortBy, expected) => {
    expect(buildUsersPrimaryOrder(sortBy, 'asc')).toEqual(expected);
  });

  it('każdy klucz sortu kończy się remisem po id (stabilny kursor)', async () => {
    const findMany = vi.fn(async (_args: unknown) => []);
    mockDb({
      ...statsStubs(),
      user: { findMany },
      $queryRaw: rawStub(vi.fn(async () => [])),
    });

    await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: {
        sort_by: 'photos',
        sort_order: 'desc',
        cursor: 'usr_c_000000000000000003',
      },
    });

    const args = findMany.mock.calls[0]?.[0] as {
      orderBy: unknown[];
      cursor: unknown;
      skip: number;
    };
    expect(args.orderBy).toEqual([
      { stylist_account: { gallery_record: { _count: 'desc' } } },
      { id: 'desc' },
    ]);
    expect(args.cursor).toEqual({ id: 'usr_c_000000000000000003' });
    expect(args.skip).toBe(1);
  });
});

describe('adminGetUsersPaginated_IO — liczby dla analizy (stats)', () => {
  it('liczy partiami dla całej strony i przypisuje obie strony pary', async () => {
    const stylist = {
      ...userRow('usr_s_000000000000000001'),
      last_login_at: new Date('2026-10-20T10:00:00.000Z'),
      stylist_account: {
        pricing_plan: 'PRO',
        payment_status: 'PAID',
        account_status: 'ACTIVE',
        trial_started_at: null,
        trial_ends_at: null,
        account_id: 'acc_s',
        address_city: ' Kraków ',
        email_marketing: false,
      },
      client_account: null,
    };
    const client = {
      ...userRow('usr_k_000000000000000002'),
      account_type: 'CLIENT',
      role_id: SystemRoleId.CLIENT_ROLE,
      notifications_enabled: false,
      client_account: { client_account_id: 'cli_k' },
    };
    const galleryGroupBy = vi.fn(
      async (args: { where: { is_pinned?: true } }) =>
        args.where.is_pinned === true
          ? [{ created_by_account_id: 'acc_s', _count: { _all: 2 } }]
          : [{ created_by_account_id: 'acc_s', _count: { _all: 9 } }]
    );
    const sessionGroupBy = vi.fn(async (args: { by: string[] }) =>
      args.by[0] === 'client_account_id'
        ? [{ client_account_id: 'cli_k', _count: { _all: 3 } }]
        : [{ stylist_account_id: 'acc_s', _count: { _all: 1 } }]
    );
    const pairFindMany = vi.fn(async () => [
      {
        id: 'pair_1',
        client_user_id: client.id,
        stylist_account_id: 'acc_s',
        status: 'ACTIVE',
      },
      {
        id: 'pair_2',
        client_user_id: 'usr_other',
        stylist_account_id: 'acc_s',
        status: 'REVOKED',
      },
    ]);
    const messageGroupBy = vi.fn(async () => [
      { pair_id: 'pair_1', sender_type: 'CLIENT', _count: { _all: 4 } },
      { pair_id: 'pair_1', sender_type: 'STYLIST', _count: { _all: 5 } },
      { pair_id: 'pair_2', sender_type: 'STYLIST', _count: { _all: 1 } },
      { pair_id: 'pair_2', sender_type: 'CLIENT', _count: { _all: 7 } },
    ]);
    mockDb({
      ...statsStubs(),
      user: { findMany: async () => [stylist, client] },
      $queryRaw: rawStub(vi.fn(async () => [])),
      galleryRecord: { groupBy: galleryGroupBy },
      sessionContainer: { groupBy: sessionGroupBy },
      clientStylistPair: { findMany: pairFindMany },
      stylistClientMessage: { groupBy: messageGroupBy },
      supportThread: {
        groupBy: async () => [{ user_id: client.id, _count: { _all: 2 } }],
      },
      pushSubscription: {
        groupBy: async () => [{ user_id: stylist.id, _count: { _all: 1 } }],
      },
      staffMember: {
        findMany: async () => [
          { user_id: 'usr_member', stylist_account_id: 'acc_s' },
        ],
      },
    });

    const result = await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: {},
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const [stylistRecord, clientRecord] = result.data.records;
    expect(stylistRecord?.last_login_at).toEqual(stylist.last_login_at);
    expect(stylistRecord?.stats).toEqual({
      photos: 9,
      public_works: 2,
      connections: 1,
      inspiration_sessions: 1,
      messages_sent: 6,
      support_threads: 0,
      push_devices: 1,
      city: 'Kraków',
      team_role: 'OWNER',
      notifications_enabled: true,
      email_marketing: false,
    });
    expect(clientRecord?.stats).toEqual({
      photos: null,
      public_works: null,
      connections: 1,
      inspiration_sessions: 3,
      messages_sent: 4,
      support_threads: 2,
      push_devices: 0,
      city: null,
      team_role: null,
      notifications_enabled: false,
      email_marketing: null,
    });
    // One query per figure for the whole page, not one per row.
    expect(galleryGroupBy).toHaveBeenCalledTimes(2);
    expect(sessionGroupBy).toHaveBeenCalledTimes(2);
    expect(messageGroupBy).toHaveBeenCalledTimes(1);
    // Internal ids never leak into the projection.
    expect(stylistRecord?.stylist_account).not.toHaveProperty('account_id');
  });
});

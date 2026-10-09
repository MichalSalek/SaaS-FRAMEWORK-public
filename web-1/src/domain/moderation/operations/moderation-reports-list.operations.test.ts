/**
 * Moderation reports-list unit tests — getContentReports_IO (admin queue view).
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. Only real branch logic is asserted (no shape tautologies):
 *
 *  - defense-in-depth admin gate at the OPERATION boundary (route RBAC aside);
 *  - status filter propagates to BOTH the page query and the total count (same
 *    WHERE — otherwise pagination math drifts from the filtered list);
 *  - page/limit clamped at the operation boundary (page>=1, limit<=100, floats
 *    floored, NaN collapses to defaults) so a rogue caller can't overflow OFFSET;
 *  - owner_active_strikes joined from ONE grouped rolling-window query (dedup'd
 *    owner ids; owner absent from groups → 0; orphaned record → gallery_record
 *    null) and the groupBy is SKIPPED entirely when the page has no owners;
 *  - explicit field-pick: internal resolved_by_id scalar must NOT leak into the
 *    response items (finding C3 contract-drift).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { getContentReports_IO } from './moderation-reports-list.operations';
import { ContentReportStatusValue } from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const ACCOUNT_ID = 'acc_test_0000000000001';
const OWNER_A = 'usr_test_owner_a_00001';
const OWNER_B = 'usr_test_owner_b_00001';
const FIXED_DATE = new Date('2026-07-01T00:00:00.000Z');

const adminCurrentUser = () =>
  makeStylistCurrentUser({
    user: { id: 'usr_test_admin_000001', role_id: SystemRoleId.MASTER_ADMIN },
  });

type DbReportRow = Record<string, unknown>;

const makeDbReport = (over: DbReportRow = {}): DbReportRow => ({
  id: 'rep_test_0000000000001',
  gallery_record_id: 'gr_test_00000000000001',
  reporter_id: 'usr_test_reporter_0001',
  reason: 'SPAM',
  description: null,
  status: ContentReportStatusValue.PENDING,
  admin_note: null,
  created_at: FIXED_DATE,
  resolved_at: null,
  // Internal moderator id — Prisma returns it as a scalar of the row; the op
  // MUST NOT copy it into the response (explicit field-pick, finding C3).
  resolved_by_id: 'usr_internal_moderator',
  gallery_record: {
    asset_url: 'https://cdn.test/a.jpg',
    created_by_account_id: ACCOUNT_ID,
    created_by_account: { created_by_user_id: OWNER_A },
  },
  reporter: { email: 'reporter@test.local', name: 'Reporter' },
  ...over,
});

type ListScenario = {
  reports?: DbReportRow[];
  totalCount?: number;
  strikeGroups?: Array<{ user_id: string; _count: { _all: number } }>;
  /**
   * Autorzy zgłoszeń zwracani przez OSOBNE zapytanie. `reporter_id` jest soft-FK
   * (patrz DECISION przy modelu w schema.prisma), więc zgłoszenie przeżywa usunięcie
   * autora i lista dociąga go dodatkowym `user.findMany`. Domyślnie PUSTA tablica —
   * czyli scenariusz „autor już nie istnieje", w którym odpowiedź ma mieć
   * `reporter: null`, a nie wywalić się.
   */
  reporters?: Array<{ id: string; email: string; name: string }>;
};

const mockListScenario = ({
  reports = [],
  totalCount = 0,
  strikeGroups = [],
  reporters = [],
}: ListScenario = {}) => {
  const findMany = vi.fn(async (_arg: unknown) => reports);
  const count = vi.fn(async (_arg: unknown) => totalCount);
  const groupBy = vi.fn(async (_arg: unknown) => strikeGroups);
  const userFindMany = vi.fn(async (_arg: unknown) => reporters);
  mockDb({
    contentReport: { findMany, count },
    moderationStrike: { groupBy },
    user: { findMany: userFindMany },
  });
  return { findMany, count, groupBy, userFindMany };
};

const callList = (
  params: Parameters<typeof getContentReports_IO>[0]['params'] = {}
) => getContentReports_IO({ currentUser: adminCurrentUser(), params });

describe('getContentReports_IO — lista zgłoszeń dla admina', () => {
  it('nie-admin → ADMIN_INSUFFICIENT_PERMISSIONS, zero dostępu do DB', async () => {
    const { findMany, count } = mockListScenario();

    const result = await getContentReports_IO({
      currentUser: makeStylistCurrentUser(),
      params: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('filtr statusu trafia do OBU zapytań (findMany + count) tym samym WHERE', async () => {
    const { findMany, count } = mockListScenario();

    const result = await callList({
      status: ContentReportStatusValue.PENDING,
    });

    expect(result.success).toBe(true);
    const findArg = findMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, string>>;
    };
    const countArg = count.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(findArg.where).toEqual({
      status: ContentReportStatusValue.PENDING,
    });
    expect(countArg.where).toEqual({
      status: ContentReportStatusValue.PENDING,
    });
    // Deterministic keyset ordering (created_at DESC, id DESC tiebreaker) —
    // stable pagination is part of the contract.
    expect(findArg.orderBy).toEqual([{ created_at: 'desc' }, { id: 'desc' }]);
  });

  it('brak filtra statusu → WHERE {} (wszystkie statusy)', async () => {
    const { findMany, count } = mockListScenario();

    const result = await callList({});

    expect(result.success).toBe(true);
    const findArg = findMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    const countArg = count.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(findArg.where).toEqual({});
    expect(countArg.where).toEqual({});
  });

  it('paginacja: page/limit clampowane na granicy operacji (overflow-safe skip/take)', async () => {
    const capturePaging = async (
      page: number | undefined,
      limit: number | undefined
    ): Promise<{ skip: number; take: number }> => {
      const { findMany } = mockListScenario();
      const result = await callList({ page, limit });
      expect(result.success).toBe(true);
      const arg = findMany.mock.calls[0]?.[0] as unknown as {
        skip: number;
        take: number;
      };
      return { skip: arg.skip, take: arg.take };
    };

    // Regular paging math.
    expect(await capturePaging(3, 10)).toEqual({ skip: 20, take: 10 });
    // Defaults.
    expect(await capturePaging(undefined, undefined)).toEqual({
      skip: 0,
      take: 20,
    });
    // Floor at 1 (page 0 / negative can't produce negative OFFSET).
    expect(await capturePaging(0, 10)).toEqual({ skip: 0, take: 10 });
    // Limit ceiling 100.
    expect(await capturePaging(1, 500)).toEqual({ skip: 0, take: 100 });
    // Floats floored (Prisma rejects non-integer skip/take).
    expect(await capturePaging(2, 7.9)).toEqual({ skip: 7, take: 7 });
    // Non-finite collapses to defaults, not NaN-poisoned skip.
    expect(await capturePaging(Number.NaN, Number.NaN)).toEqual({
      skip: 0,
      take: 20,
    });
  });

  it('mapowanie: strikes z jednego groupBy, brakujący owner→0, orphan→null, resolved_by_id NIE wycieka', async () => {
    const rows = [
      makeDbReport({ id: 'rep_a' }), // owner A — 2 active strikes
      makeDbReport({
        id: 'rep_b',
        gallery_record: {
          asset_url: 'https://cdn.test/b.jpg',
          created_by_account_id: 'acc_test_0000000000002',
          created_by_account: { created_by_user_id: OWNER_B },
        },
      }), // owner B — absent from groups → 0
      makeDbReport({
        id: 'rep_orphan',
        gallery_record_id: null,
        gallery_record: null,
      }), // orphaned (SetNull)
    ];
    const { groupBy } = mockListScenario({
      reports: rows,
      totalCount: 3,
      strikeGroups: [{ user_id: OWNER_A, _count: { _all: 2 } }],
    });

    const result = await callList({});

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.total_count).toBe(3);
    expect(result.data.reports).toHaveLength(3);

    const [a, b, orphan] = result.data.reports;
    expect(a?.gallery_record?.gallery_record_owner_user_id).toBe(OWNER_A);
    expect(a?.gallery_record?.owner_active_strikes).toBe(2);
    expect(b?.gallery_record?.gallery_record_owner_user_id).toBe(OWNER_B);
    expect(b?.gallery_record?.owner_active_strikes).toBe(0);
    expect(orphan?.gallery_record).toBeNull();

    // Contract guard (finding C3): the internal moderator id is picked OUT.
    expect(a).not.toHaveProperty('resolved_by_id');
    expect(orphan).not.toHaveProperty('resolved_by_id');

    // ONE grouped query: dedup'd owner ids, rolling window (expires_at > now).
    expect(groupBy).toHaveBeenCalledTimes(1);
    const groupArg = groupBy.mock.calls[0]?.[0] as unknown as {
      by: string[];
      where: { user_id: { in: string[] }; expires_at: { gt: Date } };
    };
    expect(groupArg.by).toEqual(['user_id']);
    expect(groupArg.where.user_id.in).toEqual([OWNER_A, OWNER_B]);
    expect(groupArg.where.expires_at.gt).toBeInstanceOf(Date);
  });

  it('strona bez ownerów (same orphany) → groupBy w ogóle nie jest wołane', async () => {
    const { groupBy } = mockListScenario({
      reports: [
        makeDbReport({
          id: 'rep_orphan',
          gallery_record_id: null,
          gallery_record: null,
        }),
      ],
      totalCount: 1,
    });

    const result = await callList({});

    expect(result.success).toBe(true);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('autor zgłoszenia: obecny → dane, usunięty → null (soft-FK, sprawa zostaje w kolejce)', async () => {
    // Regresja, którą to pinuje: twardy FK z kaskadą kasował zgłoszenia razem
    // z kontem autora — również PENDING, dotyczące treści, która zostawała żywa.
    // Teraz wiersz przeżywa, więc odczyt MUSI umieć pokazać go bez autora.
    const rows = [
      makeDbReport({ id: 'rep_zywy_autor' }),
      makeDbReport({ id: 'rep_usuniety_autor' }),
    ];
    const { userFindMany } = mockListScenario({
      reports: rows,
      totalCount: rows.length,
      reporters: [],
    });

    const result = await callList({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reports.length).toBe(rows.length);
      for (const report of result.data.reports) {
        expect(report.reporter).toBeNull();
      }
    }
    // Jedno zapytanie na STRONĘ wyników, nie na wiersz.
    expect(userFindMany).toHaveBeenCalledTimes(1);
  });

  it('błąd DB → DATABASE_ERROR', async () => {
    mockDb({
      contentReport: {
        findMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
        count: vi.fn(async () => 0),
      },
    });

    const result = await callList({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

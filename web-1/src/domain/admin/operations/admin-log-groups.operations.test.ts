/**
 * ADMIN LOG-TRIAGE unit tests — adminGetLogGroups_IO / adminSetLogIssueStatus_IO
 * (admin-log-groups.operations.ts).
 *
 * Pinowane zachowania (każde było realnym błędem panelu logów):
 *  - `regressed` liczy się z `last_seen_any` (aktywność we WSZYSTKICH środowiskach),
 *    więc werdykt nie zmienia się razem z filtrem środowiska — status jest globalny,
 *    więc dowód regresji też musi być globalny (DECISION w pliku operacji);
 *  - sortowanie grup ma stabilny rozstrzygacz (`g.fingerprint`), inaczej cięcie na
 *    LIMIT jest niedeterministyczne przy remisie count/last_seen;
 *  - zapis statusu jest CZĘŚCIOWY dla notatki: brak klucza `note` nie kasuje notatki,
 *    pusty string kasuje ją jawnie;
 *  - odcisk palca bez ani jednego pasującego logu NIE zakłada wiersza-widma —
 *    aktualizuje wyłącznie wiersz już istniejący, a poza tym 404.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const { appLogs } = vi.hoisted(() => ({
  appLogs: {
    logIssueStatus: {
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: {}, useAppLogs: appLogs },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  adminGetLogGroups_IO,
  adminSetLogIssueStatus_IO,
} from './admin-log-groups.operations';

const admin = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});
const FINGERPRINT = 'a'.repeat(32);

/** Wiersz agregatu w kształcie, jaki zwraca zapytanie grupujące. */
const groupRow = (overrides: Record<string, unknown> = {}) => ({
  fingerprint: FINGERPRINT,
  application: 'backend',
  type: 'error',
  namespace: 'DATABASE_ERROR',
  sample_message: 'quota exceeded',
  sample_id: 42,
  count: BigInt(3),
  first_seen: new Date('2026-01-01T00:00:00Z'),
  last_seen: new Date('2026-01-02T00:00:00Z'),
  last_seen_any: null,
  stored_status: null,
  note: null,
  status_updated_at: null,
  total_groups: BigInt(1),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('adminGetLogGroups_IO — status pochodny i determinizm listy', () => {
  it('zwraca `regressed`, gdy błąd wrócił w INNYM środowisku niż aktualny filtr', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([
      groupRow({
        stored_status: 'fixed',
        status_updated_at: new Date('2026-02-01T00:00:00Z'),
        // W tym wycinku ostatnie wystąpienie jest SPRZED oznaczenia…
        last_seen: new Date('2026-01-02T00:00:00Z'),
        // …ale gdzie indziej klasa błędu wróciła po oznaczeniu.
        last_seen_any: new Date('2026-03-01T00:00:00Z'),
      }),
    ]);

    const result = await adminGetLogGroups_IO({
      body: { environment: 'PRODUCTION' },
      currentUser: admin,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups[0]?.status).toBe('regressed');
    }
  });

  it('zostawia `fixed`, gdy nigdzie nie było nawrotu po oznaczeniu', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([
      groupRow({
        stored_status: 'fixed',
        status_updated_at: new Date('2026-04-01T00:00:00Z'),
        last_seen_any: new Date('2026-03-01T00:00:00Z'),
      }),
    ]);

    const result = await adminGetLogGroups_IO({ body: {}, currentUser: admin });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groups[0]?.status).toBe('fixed');
    }
  });

  it('sortuje ze stabilnym rozstrzygaczem (fingerprint) i liczy regresję poza zawężeniem', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([]);

    await adminGetLogGroups_IO({
      body: { environment: 'PRODUCTION' },
      currentUser: admin,
    });

    const sql = String(
      (appLogs.$queryRaw.mock.calls[0]?.[0] as { sql: string }).sql
    );
    expect(sql).toMatch(
      /ORDER BY g\.count DESC, g\.last_seen DESC, g\.fingerprint/
    );
    // CTE dowodu regresji NIE korzysta z filtra panelu (`buildScopeFilter` wchodzi
    // wyłącznie do `scoped`), więc werdykt jest ten sam przy każdym zawężeniu.
    expect(sql).toContain('fixed_activity');
    expect(sql).toContain('LEFT JOIN fixed_activity fa');
  });

  it('nie-admin → ADMIN_INSUFFICIENT_PERMISSIONS bez dotknięcia bazy', async () => {
    const result = await adminGetLogGroups_IO({
      body: {},
      currentUser: makeStylistCurrentUser({
        user: { role_id: SystemRoleId.STYLIST_ROLE },
      }),
    });

    expect(result.success).toBe(false);
    expect(appLogs.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('adminSetLogIssueStatus_IO — częściowa aktualizacja notatki', () => {
  const sampleRow = [
    {
      application: 'backend',
      type: 'error',
      namespace: 'DATABASE_ERROR',
      message: 'quota exceeded',
    },
  ];

  it('brak klucza `note` NIE kasuje istniejącej notatki', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce(sampleRow);
    appLogs.logIssueStatus.upsert.mockResolvedValueOnce({});

    await adminSetLogIssueStatus_IO({
      body: { fingerprint: FINGERPRINT, status: 'fixed' },
      currentUser: admin,
    });

    const args = appLogs.logIssueStatus.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect('note' in args.update).toBe(false);
    expect(args.update.status).toBe('fixed');
  });

  it('pusty `note` to jawne skasowanie notatki (NULL)', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce(sampleRow);
    appLogs.logIssueStatus.upsert.mockResolvedValueOnce({});

    await adminSetLogIssueStatus_IO({
      body: { fingerprint: FINGERPRINT, status: 'known', note: '' },
      currentUser: admin,
    });

    const args = appLogs.logIssueStatus.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(args.update.note).toBeNull();
  });

  it('podana treść notatki trafia do bazy', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce(sampleRow);
    appLogs.logIssueStatus.upsert.mockResolvedValueOnce({});

    await adminSetLogIssueStatus_IO({
      body: {
        fingerprint: FINGERPRINT,
        status: 'known',
        note: 'czekam na fix',
      },
      currentUser: admin,
    });

    const args = appLogs.logIssueStatus.upsert.mock.calls[0]?.[0] as {
      update: Record<string, unknown>;
    };
    expect(args.update.note).toBe('czekam na fix');
  });

  it('status `new` kasuje wiersz zamiast go zapisywać', async () => {
    appLogs.logIssueStatus.deleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await adminSetLogIssueStatus_IO({
      body: { fingerprint: FINGERPRINT, status: 'new' },
      currentUser: admin,
    });

    expect(result.success).toBe(true);
    expect(appLogs.logIssueStatus.deleteMany).toHaveBeenCalledTimes(1);
    expect(appLogs.logIssueStatus.upsert).not.toHaveBeenCalled();
  });
});

describe('adminSetLogIssueStatus_IO — odcisk palca bez logów', () => {
  it('bez logów i bez wiersza statusu → ADMIN_TARGET_NOT_FOUND, żaden wiersz-widmo nie powstaje', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([]);
    appLogs.logIssueStatus.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await adminSetLogIssueStatus_IO({
      body: { fingerprint: FINGERPRINT, status: 'fixed' },
      currentUser: admin,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
    expect(appLogs.logIssueStatus.upsert).not.toHaveBeenCalled();
  });

  it('bez logów, ale z istniejącym wierszem → aktualizacja przechodzi (status przeżywa retencję)', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([]);
    appLogs.logIssueStatus.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await adminSetLogIssueStatus_IO({
      body: { fingerprint: FINGERPRINT, status: 'ignored' },
      currentUser: admin,
    });

    expect(result.success).toBe(true);
    expect(appLogs.logIssueStatus.upsert).not.toHaveBeenCalled();
    const args = appLogs.logIssueStatus.updateMany.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(args.data.status).toBe('ignored');
    expect('note' in args.data).toBe(false);
  });
});

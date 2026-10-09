/**
 * ADMIN LOGS unit tests — adminGetLogs_IO / cleanupOldEventLogs_IO
 * (admin-logs.operations.ts).
 *
 * Pinowane zachowania:
 *  - statystyki opisują JEDEN zbiór: przy zawężeniu filtrem data najstarszego
 *    rekordu liczy się na tym samym `where` co licznik (wcześniej licznik był
 *    filtrowany, a data globalna — panel pokazywał sprzeczne liczby);
 *  - retencja sprząta wiersze-widma triage'u (opis 'unknown' = status nadany
 *    odciskowi bez logów), ale NIE rusza statusów osieroconych przez retencję.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const { appLogs } = vi.hoisted(() => ({
  appLogs: {
    appLogRecord: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
    logIssueStatus: { deleteMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: {}, useAppLogs: appLogs },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('./admin-runtime-config.operations', () => ({
  getRuntimeConfigValue: vi.fn(
    async (_key: string, fallback: string) => fallback
  ),
}));

import {
  adminGetLogs_IO,
  cleanupOldEventLogs_IO,
} from './admin-logs.operations';

const admin = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});

beforeEach(() => {
  vi.clearAllMocks();
  appLogs.appLogRecord.findMany.mockResolvedValue([]);
  appLogs.appLogRecord.count.mockResolvedValue(7);
  appLogs.appLogRecord.findFirst.mockResolvedValue({
    created_at: new Date('2026-01-01T00:00:00Z'),
  });
});

describe('adminGetLogs_IO — statystyki zgodne z zawężeniem', () => {
  it('data najstarszego rekordu liczy się na TYM SAMYM where co licznik', async () => {
    const result = await adminGetLogs_IO({
      body: { environment: 'PRODUCTION', application: 'backend' },
      currentUser: admin,
    });

    expect(result.success).toBe(true);
    const where = { environment: 'PRODUCTION', application: 'backend' };
    expect(appLogs.appLogRecord.count).toHaveBeenCalledWith({ where });
    expect(appLogs.appLogRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where })
    );
  });

  it('bez filtra nie dokłada where (licznik idzie po szacunku z pg_class)', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([{ reltuples: BigInt(1234) }]);

    const result = await adminGetLogs_IO({ body: {}, currentUser: admin });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalCount).toBe(1234);
    }
    const args = appLogs.appLogRecord.findFirst.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect('where' in args).toBe(false);
    expect(appLogs.appLogRecord.count).not.toHaveBeenCalled();
  });
});

describe('cleanupOldEventLogs_IO — sprzątanie wierszy-widm triage', () => {
  it('kasuje statusy z opisem `unknown` starsze niż okno retencji', async () => {
    appLogs.appLogRecord.deleteMany.mockResolvedValueOnce({ count: 5 });
    appLogs.appLogRecord.count.mockResolvedValueOnce(0);
    appLogs.logIssueStatus.deleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await cleanupOldEventLogs_IO({ currentUser: admin });

    expect(result.success).toBe(true);
    if (result.success) {
      // Liczba dotyczy usuniętych LOGÓW — wiersze-widma nie zawyżają jej.
      expect(result.data.deleted).toBe(5);
    }
    const args = appLogs.logIssueStatus.deleteMany.mock.calls[0]?.[0] as {
      where: { application: string; updated_at: { lt: Date } };
    };
    expect(args.where.application).toBe('unknown');
    expect(args.where.updated_at.lt).toBeInstanceOf(Date);
    // To samo odcięcie co dla logów (90 dni domyślnie) — nie „teraz".
    expect(args.where.updated_at.lt.getTime()).toBeLessThan(Date.now());
  });

  it('nie-admin → ADMIN_INSUFFICIENT_PERMISSIONS, zero kasowania', async () => {
    const result = await cleanupOldEventLogs_IO({
      currentUser: makeStylistCurrentUser({
        user: { role_id: SystemRoleId.STYLIST_ROLE },
      }),
    });

    expect(result.success).toBe(false);
    expect(appLogs.appLogRecord.deleteMany).not.toHaveBeenCalled();
    expect(appLogs.logIssueStatus.deleteMany).not.toHaveBeenCalled();
  });
});

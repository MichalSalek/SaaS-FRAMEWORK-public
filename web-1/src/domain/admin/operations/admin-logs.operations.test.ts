/**
 * ADMIN LOGS unit tests — adminGetLogs_IO / cleanupOldEventLogs_IO
 * (admin-logs.operations.ts).
 *
 * Pinned behaviors:
 *  - the stats describe ONE set: under a filter, the oldest-record date is computed on the
 *    same `where` as the counter (a filtered counter next to a global date made the panel
 *    show contradictory numbers);
 *  - retention sweeps ghost triage rows (application 'unknown' = a status set on a
 *    fingerprint with no logs) but does NOT touch statuses orphaned by retention.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const { appLogs, logWrite } = vi.hoisted(() => ({
  logWrite: vi.fn(async () => undefined),
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
vi.mock('@app/debugger/error-handler-io', () => ({
  createEventLogRecord_IO: logWrite,
}));
vi.mock('./admin-runtime-config.operations', () => ({
  getRuntimeConfigValue: vi.fn(
    async (_key: string, fallback: string) => fallback
  ),
}));

import {
  adminGetLogs_IO,
  adminSendLog_IO,
  cleanupOldEventLogs_IO,
} from './admin-logs.operations';

const admin = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});

describe('adminSendLog_IO observation URL redaction', () => {
  it.each([
    [
      'https://nailfolio.app/api/v1/public/newsletter-confirm/private-token?locale=pl',
      'https://nailfolio.app/api/v1/public/newsletter-confirm/[REDACTED]',
    ],
    [
      'https://nailfolio.app/app/user/account/plan?token=private-token',
      'https://nailfolio.app/app/user/account/plan',
    ],
    [
      'https://nailfolio.app/app/user/account/plan',
      'https://nailfolio.app/app/user/account/plan',
    ],
  ])('sanitizes a client-supplied page URL %s', async (clientUrl, expected) => {
    const result = await adminSendLog_IO({
      body: {
        environment: 'PRODUCTION',
        namespace: 'window.error',
        type: 'error',
        message: 'Client failure',
        payload: '{}',
        user_id: null,
        user_metadata: '{}',
        client_url: clientUrl,
      },
      sessionUserId: null,
    });

    expect(result.success).toBe(true);
    expect(logWrite).toHaveBeenCalledWith(
      expect.objectContaining({ client_url: expected, user_id: null })
    );
  });
});

describe('adminSendLog_IO legacy JSON payload redaction', () => {
  const send = (payload: string) =>
    adminSendLog_IO({
      body: {
        environment: 'PRODUCTION',
        namespace: 'legacy_client',
        type: 'error',
        message: 'Client failure',
        payload,
        user_id: null,
        user_metadata: '{}',
        client_url: '/app',
      },
      sessionUserId: null,
    });
  const stored = () =>
    (logWrite.mock.calls.at(-1) as unknown as [{ payload: string }])[0].payload;

  it('redacts nested note families, secrets and email at the actual sink', async () => {
    await send(
      JSON.stringify({
        request: {
          note: 'secret one',
          importantNote: 'secret two',
          'request-note': 'secret three',
          body: [{ private_notes: 'secret four', email: 'person@example.com' }],
        },
        token: 'secret token',
        code: 'E_TIMEOUT',
      })
    );
    expect(JSON.parse(stored())).toEqual({
      request: {
        note: '[REDACTED]',
        importantNote: '[REDACTED]',
        'request-note': '[REDACTED]',
        body: [{ private_notes: '[REDACTED]', email: '[EMAIL]@example.com' }],
      },
      token: '[REDACTED]',
      code: 'E_TIMEOUT',
    });
  });
  it('scrubs credentials before persisting JSON error-like metadata', async () => {
    await send(
      JSON.stringify({
        exception: {
          message: 'failed at postgres://alice:secret@db.example/test',
          stack: 'stack details',
          code: 'CONNECTION',
        },
      })
    );
    const parsed = JSON.parse(stored());
    expect(stored()).not.toContain('alice:secret');
    expect(parsed.exception).toMatchObject({
      message: 'failed at postgres://[REDACTED]@db.example/test',
      stack: 'stack details',
      code: 'CONNECTION',
    });
  });
  it('redacts before applying the defensive payload cap', async () => {
    await send(
      JSON.stringify({ note: 'never persist', details: 'x'.repeat(9_000) })
    );
    expect(stored()).not.toContain('never persist');
    expect(stored().length).toBe(8_000);
    expect(stored()).toMatch(/\.\.\.\[TRUNCATED\]$/);
  });
  it.each([
    'plain text',
    '{"request":',
    '{\n  "diagnostic": "safe",\n  "status": 502\n}',
  ])('retains unchanged input byte-for-byte: %s', async input => {
    await send(input);
    expect(stored()).toBe(input);
  });
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
      // The count covers deleted LOGS; ghost rows do not inflate it.
      expect(result.data.deleted).toBe(5);
    }
    const args = appLogs.logIssueStatus.deleteMany.mock.calls[0]?.[0] as {
      where: { application: string; updated_at: { lt: Date } };
    };
    expect(args.where.application).toBe('unknown');
    expect(args.where.updated_at.lt).toBeInstanceOf(Date);
    // The same cutoff as for logs (90 days by default), not "now".
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

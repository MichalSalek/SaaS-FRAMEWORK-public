/**
 * ADMIN ATTENTION-COUNTS unit tests (finding F1).
 *
 * Licznik "support czeka na odpowiedź" MUSI powstawać w SQL. Wcześniej operacja
 * robiła findMany po 500 wątkach OPEN z zagnieżdżonym `messages: { take: 1 }` —
 * Prisma tnie takie `take` dopiero w Node, więc każdy poll dashboardu admina
 * ściągał całą historię otwartych wątków, żeby policzyć jedną liczbę.
 *
 * Zdrowie i grupy logów dochodzą tym samym kontraktem: zdrowie z cache'owanego
 * snapshotu (nie z żywego TLS na każdy poll), logi z jednego COUNT po odcisku.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import type { ServiceHealthSnapshot } from '@app/health/service-health.snapshot';
import type * as ServiceHealthSnapshotModule from '@app/health/service-health.snapshot';

const {
  mainQueryRaw,
  contentReportCount,
  threadFindMany,
  userCount,
  eventLogFindFirst,
  appLogsQueryRaw,
  healthSnapshot,
} = vi.hoisted(() => ({
  mainQueryRaw: vi.fn(),
  contentReportCount: vi.fn(),
  threadFindMany: vi.fn(),
  userCount: vi.fn(),
  eventLogFindFirst: vi.fn(),
  appLogsQueryRaw: vi.fn(),
  healthSnapshot: vi.fn(),
}));

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      $queryRaw: mainQueryRaw,
      contentReport: { count: contentReportCount },
      supportThread: { findMany: threadFindMany },
      user: { count: userCount },
      eventLog: { findFirst: eventLogFindFirst },
    },
    useAppLogs: {
      $queryRaw: appLogsQueryRaw,
    },
  },
}));

vi.mock('@app/health/service-health.snapshot', async () => {
  const actual = await vi.importActual<typeof ServiceHealthSnapshotModule>(
    '@app/health/service-health.snapshot'
  );
  return {
    ...actual,
    getCachedServiceHealthSnapshot: healthSnapshot,
  };
});

// The pipeline module pulls Stripe and the whole sweep audience code in; the
// counter needs only its sweep reader, which goes through the mocked DB.
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({ getStripe: vi.fn() }));

import { getAdminAttentionCounts_IO } from './admin-attention.operations';
import { buildSupportAwaitingReplyCountQuery } from '@domain/support/operations/support-awaiting-reply.predicate';
import {
  buildPaymentsAttentionWhere,
  buildStuckAccountsWhere,
} from './admin-user-attention.predicates';
import { ADMIN_ATTENTION } from '@kernel/domain/admin/admin-attention.config';
import { TIME } from '@kernel/application/constants.config';

const NOW = new Date('2026-10-08T12:00:00.000Z');

const adminCaller = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});
const nonAdminCaller = makeStylistCurrentUser({
  user: { id: 'usr_pleb_0000000000000001', role_id: SystemRoleId.STYLIST_ROLE },
});

const healthyService = (name: string): ServiceHealthSnapshot['database'] => ({
  name,
  status: 'healthy',
  latency_ms: 20,
  message: null,
});

const healthySnapshot = (): ServiceHealthSnapshot => ({
  database: healthyService('Database (main)'),
  event_log_db: healthyService('Event Log DB'),
  external_services: [],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  userCount.mockReset();
  userCount.mockResolvedValue(0);
  // A sweep one hour ago: the mail pipeline is alive unless a test says otherwise.
  eventLogFindFirst.mockResolvedValue({
    created_at: new Date(NOW.getTime() - TIME.MS_PER_HOUR),
    event_payload: null,
  });
  mainQueryRaw.mockResolvedValue([{ awaiting_reply: 0 }]);
  contentReportCount.mockResolvedValue(0);
  threadFindMany.mockResolvedValue([]);
  appLogsQueryRaw.mockResolvedValue([{ open_groups: 0 }]);
  healthSnapshot.mockResolvedValue(healthySnapshot());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getAdminAttentionCounts_IO', () => {
  it('bierze licznik ze skalara SQL i NIE materializuje wątków', async () => {
    mainQueryRaw.mockResolvedValue([{ awaiting_reply: 12 }]);
    contentReportCount.mockResolvedValue(4);

    const result = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data).toEqual({
      support_awaiting_reply: 12,
      moderation_pending: 4,
      system_health_issues: 0,
      log_issues_open: 0,
      payments_attention: 0,
      stuck_accounts: 0,
      email_sweep_issues: 0,
    });
    expect(threadFindMany).not.toHaveBeenCalled();
    expect(healthSnapshot).toHaveBeenCalledOnce();

    const logQuery = appLogsQueryRaw.mock.calls[0]?.[0] as {
      strings: string[];
      values: unknown[];
    };
    const sqlText = logQuery.strings.join(' ');
    expect(sqlText).toContain('AppLogRecord');
    expect(sqlText).toContain('LogIssueStatus');
    expect(sqlText).toContain('md5(');
    expect(logQuery.values).toContain('error');
    expect(logQuery.values).toContain('PRODUCTION');
  });

  it('liczy usługi degraded i down, pomija healthy', async () => {
    healthSnapshot.mockResolvedValue({
      database: {
        name: 'Database (main)',
        status: 'degraded',
        latency_ms: 800,
        message: 'High latency',
      },
      event_log_db: healthyService('Event Log DB'),
      external_services: [
        {
          name: 'Stripe',
          status: 'down',
          latency_ms: null,
          message: 'timeout',
        },
        healthyService('Serwis email'),
      ],
    });

    const result = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.system_health_issues).toBe(2);
    }
  });

  it('bierze otwarte grupy logów ze skalara na bazie logów', async () => {
    appLogsQueryRaw.mockResolvedValue([{ open_groups: 7 }]);

    const result = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.log_issues_open).toBe(7);
    }
    expect(appLogsQueryRaw).toHaveBeenCalledOnce();
  });

  it('brak wiersza z agregatu → 0, nie crash', async () => {
    mainQueryRaw.mockResolvedValue([]);
    appLogsQueryRaw.mockResolvedValue([]);

    const result = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.support_awaiting_reply).toBe(0);
      expect(result.data.log_issues_open).toBe(0);
      expect(result.data.system_health_issues).toBe(0);
    }
  });

  it('non-admin → ADMIN_INSUFFICIENT_PERMISSIONS, zero DB', async () => {
    const result = await getAdminAttentionCounts_IO({
      currentUser: nonAdminCaller,
    });

    expect(result.success).toBe(false);
    expect(mainQueryRaw).not.toHaveBeenCalled();
    expect(appLogsQueryRaw).not.toHaveBeenCalled();
    expect(healthSnapshot).not.toHaveBeenCalled();
  });

  it('błąd DB → DATABASE_ERROR', async () => {
    mainQueryRaw.mockRejectedValue(new Error('connection reset'));

    const result = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });

  it('support: the badge is the COUNT built by the shared awaiting-reply predicate', async () => {
    await getAdminAttentionCounts_IO({ currentUser: adminCaller });

    const sent = mainQueryRaw.mock.calls[0]?.[0] as {
      sql: string;
      values: unknown[];
    };
    const expected = buildSupportAwaitingReplyCountQuery();
    expect(sent.sql).toBe(expected.sql);
    expect(sent.values).toEqual(expected.values);
  });

  it('payments and stuck accounts are user counts over the shared predicates', async () => {
    userCount.mockResolvedValueOnce(2).mockResolvedValueOnce(5);

    const result = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payments_attention).toBe(2);
      expect(result.data.stuck_accounts).toBe(5);
    }
    expect(userCount.mock.calls[0]?.[0]).toEqual({
      where: buildPaymentsAttentionWhere(NOW),
    });
    expect(userCount.mock.calls[1]?.[0]).toEqual({
      where: buildStuckAccountsWhere(NOW),
    });
  });

  it('email sweep: silent longer than the limit, or never seen, is 1', async () => {
    eventLogFindFirst.mockResolvedValueOnce({
      created_at: new Date(
        NOW.getTime() -
          ADMIN_ATTENTION.EMAIL_SWEEP_MAX_SILENCE_HOURS * TIME.MS_PER_HOUR -
          1
      ),
      event_payload: null,
    });
    const stale = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });
    expect(stale.success && stale.data.email_sweep_issues).toBe(1);

    eventLogFindFirst.mockResolvedValueOnce(null);
    const never = await getAdminAttentionCounts_IO({
      currentUser: adminCaller,
    });
    expect(never.success && never.data.email_sweep_issues).toBe(1);
  });
});

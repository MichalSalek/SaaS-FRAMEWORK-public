/**
 * Log groups "needs a reaction" (S126): the menu badge and the list it links
 * to are built by ONE builder; the count is `count(*)` over the very relation
 * the attention list pages. (The SQL CASE of the display status is checked
 * against its JS twin in admin-log-display-status.helper.test.ts.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import {
  LOG_ATTENTION_SCOPE,
  LOG_ISSUE_ATTENTION_STATUSES,
  isLogIssueNeedingReaction,
} from '@kernel/domain/admin/log-triage.config';
import { TIME } from '@kernel/application/constants.config';

const { appLogs } = vi.hoisted(() => ({ appLogs: { $queryRaw: vi.fn() } }));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: {}, useAppLogs: appLogs },
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  buildLogGroupsCountQuery,
  buildLogGroupsListQuery,
  buildLogGroupsRelation,
  resolveLogGroupsScope,
} from './admin-log-groups.query';
import {
  adminGetLogGroups_IO,
  countUnsettledProductionErrorGroups,
} from './admin-log-groups.operations';

describe('attention scope', () => {
  const NOW = new Date('2026-10-08T12:00:00.000Z');

  it('ignores the client dimensions and forces the kernel scope and window', () => {
    const scope = resolveLogGroupsScope(
      {
        attention: true,
        environment: 'DEVELOPMENT',
        application: 'frontend',
        type: 'warn',
      },
      NOW
    );
    expect(scope).toEqual({
      environment: LOG_ATTENTION_SCOPE.environment,
      type: LOG_ATTENTION_SCOPE.type,
      since: new Date(
        NOW.getTime() - LOG_ATTENTION_SCOPE.windowDays * TIME.MS_PER_DAY
      ),
      onlyNeedingReaction: true,
    });
  });

  it('without the flag the request passes through, with no window', () => {
    expect(
      resolveLogGroupsScope(
        { environment: 'STAGING', application: 'backend' },
        NOW
      )
    ).toEqual({
      environment: 'STAGING',
      application: 'backend',
      type: undefined,
      onlyNeedingReaction: false,
    });
  });

  it('the kernel predicate names exactly new and regressed', () => {
    expect([...LOG_ISSUE_ATTENTION_STATUSES].sort()).toEqual([
      'new',
      'regressed',
    ]);
    expect(isLogIssueNeedingReaction('new')).toBe(true);
    expect(isLogIssueNeedingReaction('regressed')).toBe(true);
    for (const settled of ['known', 'fixed', 'ignored'] as const) {
      expect(isLogIssueNeedingReaction(settled)).toBe(false);
    }
  });
});

describe('the badge and its list are one relation', () => {
  const NOW = new Date('2026-10-08T12:00:00.000Z');
  const admin = makeStylistCurrentUser({
    user: {
      id: 'usr_admin_000000000000001',
      role_id: SystemRoleId.MASTER_ADMIN,
    },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    appLogs.$queryRaw.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('list and count are the same relation with a different final SELECT', () => {
    const scope = resolveLogGroupsScope({ attention: true }, NOW);
    const relation = buildLogGroupsRelation(scope);
    const list = buildLogGroupsListQuery(scope);
    const count = buildLogGroupsCountQuery(scope);

    expect(list.sql.startsWith(relation.sql)).toBe(true);
    expect(count.sql.startsWith(relation.sql)).toBe(true);
    expect(count.values).toEqual(relation.values);
    expect(list.values.slice(0, relation.values.length)).toEqual(
      relation.values
    );
    expect(count.sql.slice(relation.sql.length)).toMatch(
      /^\s*SELECT count\(\*\)::int AS open_groups FROM visible\s*$/
    );
  });

  it('the attention filter sits inside the relation, before the LIMIT', () => {
    const relation = buildLogGroupsRelation(
      resolveLogGroupsScope({ attention: true }, NOW)
    );
    expect(relation.sql).toMatch(/WHERE display_status IN \(/);
    expect(relation.sql).not.toContain('LIMIT');
    expect(relation.values).toEqual(
      expect.arrayContaining([
        LOG_ATTENTION_SCOPE.environment,
        LOG_ATTENTION_SCOPE.type,
        ...LOG_ISSUE_ATTENTION_STATUSES,
      ])
    );

    const ordinary = buildLogGroupsRelation(resolveLogGroupsScope({}, NOW));
    expect(ordinary.sql).not.toMatch(/WHERE display_status IN/);
    expect(ordinary.sql).not.toContain('created_at >=');
  });

  it('what the two operations send differs only by that final SELECT', async () => {
    appLogs.$queryRaw.mockResolvedValue([]);

    await countUnsettledProductionErrorGroups();
    await adminGetLogGroups_IO({
      body: { attention: true, environment: 'DEVELOPMENT' },
      currentUser: admin,
    });

    const sent = appLogs.$queryRaw.mock.calls.map(
      call => call[0] as { sql: string; values: unknown[] }
    );
    const relation = buildLogGroupsRelation(
      resolveLogGroupsScope({ attention: true }, NOW)
    );
    expect(sent).toHaveLength(2);
    for (const query of sent) {
      expect(query.sql.startsWith(relation.sql)).toBe(true);
      expect(query.values.slice(0, relation.values.length)).toEqual(
        relation.values
      );
    }
    expect(sent[1]?.values).not.toContain('DEVELOPMENT');
  });

  it('totalGroups of the attention list is the number the count returns', async () => {
    appLogs.$queryRaw.mockResolvedValueOnce([{ open_groups: 3 }]);
    expect(await countUnsettledProductionErrorGroups()).toBe(3);

    appLogs.$queryRaw.mockResolvedValueOnce([
      {
        fingerprint: 'a'.repeat(32),
        application: 'backend',
        type: 'error',
        namespace: 'DATABASE_ERROR',
        sample_message: 'quota exceeded',
        sample_id: 1,
        count: BigInt(4),
        first_seen: NOW,
        last_seen: NOW,
        last_seen_any: null,
        stored_status: null,
        note: null,
        status_updated_at: null,
        total_groups: BigInt(3),
      },
    ]);
    const list = await adminGetLogGroups_IO({
      body: { attention: true },
      currentUser: admin,
    });
    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.data.totalGroups).toBe(3);
      expect(list.data.groups[0]?.status).toBe('new');
    }
  });
});

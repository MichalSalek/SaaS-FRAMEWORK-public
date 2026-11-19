import { describe, it, expect, vi } from 'vitest';
import type { useTranslations } from 'next-intl';
import {
  USERS_CSV_PAGE_SIZE,
  buildUsersCsvTable,
  fetchAllAdminUsers,
} from './users-csv';
import { buildCSVContent, escapeCSVField } from './admin-csv';
import { buildUsersTableColumns } from './components/UsersTable.columns.config';
import type { AdminUserRecord, AdminUsersRequest } from './hooks/useAdminUsers';

type T = ReturnType<typeof useTranslations<'admin.users'>>;
// The key stands in for its translation, so the file's words are traceable.
const t = ((key: string) => `t:${key}`) as unknown as T;

const user = (
  id: string,
  overrides: Partial<AdminUserRecord> = {}
): AdminUserRecord =>
  ({
    id,
    email: `${id}@example.com`,
    emailVerified: true,
    name: 'Anna Nowak',
    account_type: 'STYLIST',
    role_id: 3,
    is_active: true,
    createdAt: new Date('2026-10-01T08:30:00.000Z'),
    updatedAt: new Date('2026-10-02T08:30:00.000Z'),
    last_login_at: null,
    onboarding_completed: true,
    _count: { sessions: 2 },
    stylist_account: {
      pricing_plan: 'PRO',
      payment_status: 'PAID',
      account_status: 'ACTIVE',
      trial_started_at: null,
      trial_ends_at: null,
    },
    stats: {
      photos: 12,
      public_works: null,
      connections: 4,
      inspiration_sessions: 0,
      messages_sent: 7,
      support_threads: 0,
      push_devices: 1,
      city: null,
      team_role: null,
      notifications_enabled: true,
      email_marketing: false,
    },
    ...overrides,
  }) as AdminUserRecord;

describe('buildUsersCsvTable', () => {
  const columns = buildUsersTableColumns(t, 'pl');

  it('keeps only the chosen columns, in table order, under the table headers', () => {
    const { header } = buildUsersCsvTable(
      columns,
      new Set(['photos', 'email', 'name']),
      []
    );
    expect(header).toEqual(['t:columnName', 't:columnEmail', 't:columnPhotos']);
  });

  it('writes plain values: numbers bare, ISO dates, translated words, empty for none', () => {
    const { rows } = buildUsersCsvTable(
      columns,
      new Set([
        'name',
        'plan',
        'createdAt',
        'lastLogin',
        'photos',
        'publicWorks',
        'city',
        'payment',
        'marketing',
      ]),
      [user('u1')]
    );
    expect(rows).toEqual([
      [
        'Anna Nowak',
        'Pro',
        '2026-10-01T08:30:00.000Z',
        '12',
        '',
        '',
        '',
        't:paymentStatusLabel.PAID',
        't:no',
      ],
    ]);
  });

  it('leaves a nameless person empty instead of the table placeholder', () => {
    const { rows } = buildUsersCsvTable(columns, new Set(['name']), [
      user('u2', { name: '  ' }),
    ]);
    expect(rows).toEqual([['']]);
  });
});

describe('escapeCSVField', () => {
  it('neutralises formula starts but keeps negative numbers', () => {
    expect(escapeCSVField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCSVField('+48 600')).toBe("'+48 600");
    expect(escapeCSVField('@anna')).toBe("'@anna");
    expect(escapeCSVField('-12.5')).toBe('-12.5');
    expect(escapeCSVField('Nowak, Anna')).toBe('"Nowak, Anna"');
  });

  it('builds the file line by line', () => {
    expect(buildCSVContent(['a', 'b'], [['1', '-x']])).toBe("a,b\n1,'-x");
  });
});

describe('fetchAllAdminUsers', () => {
  const request: AdminUsersRequest = {
    take: 15,
    cursor: 'page-3',
    sort_by: 'photos',
    sort_order: 'desc',
    search: 'anna',
  };

  it('reads every page with the same filters and sort, from the first page', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        records: [user('a'), user('b')],
        nextCursor: 'b',
      })
      .mockResolvedValueOnce({ records: [user('c')], nextCursor: null });

    const result = await fetchAllAdminUsers(request, fetchPage);

    expect(result.capped).toBe(false);
    expect(result.records.map(r => r.id)).toEqual(['a', 'b', 'c']);
    expect(fetchPage).toHaveBeenNthCalledWith(1, {
      take: USERS_CSV_PAGE_SIZE,
      sort_by: 'photos',
      sort_order: 'desc',
      search: 'anna',
    });
    expect(fetchPage).toHaveBeenNthCalledWith(2, {
      take: USERS_CSV_PAGE_SIZE,
      sort_by: 'photos',
      sort_order: 'desc',
      search: 'anna',
      cursor: 'b',
    });
  });

  it('stops at the cap and says the list was longer', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      records: [user('x'), user('y')],
      nextCursor: 'more',
    });

    const result = await fetchAllAdminUsers(request, fetchPage, 3);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.records).toHaveLength(3);
    expect(result.capped).toBe(true);
  });

  it('is not capped when the list ends exactly at the cap', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue({ records: [user('x'), user('y')], nextCursor: null });

    const result = await fetchAllAdminUsers(request, fetchPage, 2);

    expect(result).toEqual({ records: [user('x'), user('y')], capped: false });
  });

  it('passes a failed page on to the caller', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('500'));
    await expect(fetchAllAdminUsers(request, fetchPage)).rejects.toThrow('500');
  });
});

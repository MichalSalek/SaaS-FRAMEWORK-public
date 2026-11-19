import { describe, it, expect } from 'vitest';
import { buildReportsCsvRows, REPORTS_CSV_HEADER } from './reports-csv';
import type { AdminReportsResponse } from './hooks/useAdminReports';

const metric = (current: number, previous: number, change: number | null) => ({
  current,
  previous,
  change_percent: change,
});

const reports: AdminReportsResponse = {
  period: 'week',
  period_start: '2026-10-10T00:00:00.000Z',
  period_end: '2026-10-17T00:00:00.000Z',
  funnel: {
    total_registrations: metric(12, 8, 50),
    active_accounts: metric(5, 5, 0),
    paid_accounts: metric(1, 0, null),
    conversion_to_active_percent: 41.7,
    conversion_to_paid_percent: 8.3,
  },
  retention: {
    active_7d: 4,
    active_30d: 9,
    total_users: 20,
    retention_7d_percent: 20,
    retention_30d_percent: 45,
  },
  revenue: {
    users_free: 10,
    users_pro: 2,
    users_pro_plus: 1,
    users_studio: 0,
    users_scale: 0,
  },
  growth: {
    new_users_per_day: [
      { date: '2026-10-16', count: 3 },
      { date: '2026-10-17', count: 1 },
    ],
  },
  top_stylists: [],
  churn: {
    disabled_in_period: metric(0, 1, -100),
    deleted_in_period: metric(0, 0, null),
  },
  cached_at: '2026-10-17T12:00:00.000Z',
};

describe('buildReportsCsvRows', () => {
  const rows = buildReportsCsvRows(reports);

  it('gives every row one cell per header column', () => {
    for (const row of rows) {
      expect(row).toHaveLength(REPORTS_CSV_HEADER.length);
    }
  });

  it('exports the plan counts without a financial estimate', () => {
    expect(rows.filter(row => row[0] === 'plans')).toEqual([
      ['plans', 'users_free', '10', '', ''],
      ['plans', 'users_pro', '2', '', ''],
      ['plans', 'users_pro_plus', '1', '', ''],
      ['plans', 'users_studio', '0', '', ''],
      ['plans', 'users_scale', '0', '', ''],
    ]);
  });

  it('keeps the previous value and the change of a compared metric', () => {
    expect(rows).toContainEqual([
      'funnel',
      'total_registrations',
      '12',
      '8',
      '50',
    ]);
    // No comparison is an empty cell, never a zero.
    expect(rows).toContainEqual(['funnel', 'paid_accounts', '1', '0', '']);
  });

  it('lists the daily growth series and the covered period', () => {
    expect(rows).toContainEqual([
      'new_users_per_day',
      '2026-10-16',
      '3',
      '',
      '',
    ]);
    expect(rows[0]).toEqual(['period', 'period', 'week', '', '']);
  });
});

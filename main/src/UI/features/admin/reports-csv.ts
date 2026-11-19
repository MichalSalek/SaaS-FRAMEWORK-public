// UI/features/admin/reports-csv.ts
// The reports page as one CSV table: every number the six charts draw, plus
// the period it covers. Raw keys and raw numbers on purpose: the file is read
// by a spreadsheet, not by a person on the page.

import type { AdminReportsResponse } from './hooks/useAdminReports';
import type { MetricWithChange } from '@kernel/models/admin/admin-reports.dto';
import { downloadCSV } from './admin-csv';

export const REPORTS_CSV_HEADER = [
  'Section',
  'Metric',
  'Value',
  'Previous',
  'Change %',
] as const;

type Row = [string, string, string, string, string];

const plain = (
  section: string,
  metric: string,
  value: number | string
): Row => [section, metric, String(value), '', ''];

const withChange = (
  section: string,
  metric: string,
  value: MetricWithChange
): Row => [
  section,
  metric,
  String(value.current),
  String(value.previous),
  value.change_percent === null ? '' : String(value.change_percent),
];

export function buildReportsCsvRows(reports: AdminReportsResponse): Row[] {
  const { funnel, retention, revenue, growth, churn } = reports;
  return [
    plain('period', 'period', reports.period),
    plain('period', 'period_start', reports.period_start),
    plain('period', 'period_end', reports.period_end),
    withChange('funnel', 'total_registrations', funnel.total_registrations),
    withChange('funnel', 'active_accounts', funnel.active_accounts),
    withChange('funnel', 'paid_accounts', funnel.paid_accounts),
    plain(
      'funnel',
      'conversion_to_active_percent',
      funnel.conversion_to_active_percent
    ),
    plain(
      'funnel',
      'conversion_to_paid_percent',
      funnel.conversion_to_paid_percent
    ),
    plain('retention', 'active_7d', retention.active_7d),
    plain('retention', 'active_30d', retention.active_30d),
    plain('retention', 'total_users', retention.total_users),
    plain('retention', 'retention_7d_percent', retention.retention_7d_percent),
    plain(
      'retention',
      'retention_30d_percent',
      retention.retention_30d_percent
    ),
    plain('plans', 'users_free', revenue.users_free),
    plain('plans', 'users_pro', revenue.users_pro),
    plain('plans', 'users_pro_plus', revenue.users_pro_plus),
    plain('plans', 'users_studio', revenue.users_studio),
    plain('plans', 'users_scale', revenue.users_scale),
    withChange('churn', 'disabled_in_period', churn.disabled_in_period),
    withChange('churn', 'deleted_in_period', churn.deleted_in_period),
    ...growth.new_users_per_day.map(point =>
      plain('new_users_per_day', point.date, point.count)
    ),
  ];
}

export function exportReportsToCSV(reports: AdminReportsResponse): void {
  downloadCSV(
    `reports-${reports.period}`,
    REPORTS_CSV_HEADER,
    buildReportsCsvRows(reports)
  );
}

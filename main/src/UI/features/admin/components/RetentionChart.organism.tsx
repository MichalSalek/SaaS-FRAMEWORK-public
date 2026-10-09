// UI/features/admin/components/RetentionChart.organism.tsx
// 7-day and 30-day retention rates as vertical CSS bars in the shared admin
// panel. No activity in either window: one sentence, no bars.

import { useLocale, useTranslations } from 'next-intl';
import type { AdminReportsResponse } from '../hooks/useAdminReports';
import { formatFixed1 } from '../reports-format';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import styles from '../AdminReportsPage.module.css';

interface RetentionChartProps {
  retention: AdminReportsResponse['retention'];
}

export function RetentionChartOrganism({ retention }: RetentionChartProps) {
  const t = useTranslations('admin.reports');
  const locale = useLocale();
  // NaN-safe coercion: backend should always return finite numbers but defend
  // against undefined/null/NaN that could break .toFixed() or chart math.
  const r7 = Number.isFinite(retention.retention_7d_percent)
    ? retention.retention_7d_percent
    : 0;
  const r30 = Number.isFinite(retention.retention_30d_percent)
    ? retention.retention_30d_percent
    : 0;
  const hasActivity = retention.active_7d > 0 || retention.active_30d > 0;
  const maxPct = Math.max(r7, r30, 1);

  const bars = [
    {
      label: t('day7'),
      value: r7,
      formatted: `${formatFixed1(r7, locale)}%`,
      pct: (r7 / maxPct) * 100,
      color: 'var(--color-success)',
    },
    {
      label: t('day30'),
      value: r30,
      formatted: `${formatFixed1(r30, locale)}%`,
      pct: (r30 / maxPct) * 100,
      color: 'color-mix(in oklch, var(--color-success) 65%, transparent)',
    },
  ];

  return (
    <AdminPanelMolecule
      title={t('retention')}
      // The total is a number next to the title, not a third column among
      // two rates.
      aside={t('usersTotal', { count: retention.total_users })}
      note={t('retentionSubtitle')}>
      {hasActivity ? (
        <>
          <div className={styles.chartBarGroup}>
            {bars.map((b, idx) => (
              <div
                key={b.label}
                className={styles.chartBar}
                style={{
                  height: `${Math.max(b.pct, 3)}%`,
                  background: b.color,
                  animationDelay: `${idx * 100}ms`,
                }}
                title={`${b.label}: ${b.formatted}`}
              />
            ))}
          </div>
          <div className={styles.chartLabelsRow}>
            {bars.map(b => (
              <span key={b.label} className={styles.chartLabelCell}>
                <span className={styles.chartLabelName}>{b.label}</span>
                <span className={styles.chartLabelValue}>{b.formatted}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className={styles.emptyState}>{t('retentionEmpty')}</p>
      )}
    </AdminPanelMolecule>
  );
}

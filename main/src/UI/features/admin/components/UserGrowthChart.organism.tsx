// UI/features/admin/components/UserGrowthChart.organism.tsx
// New users per day, aggregated to at most 6 dated vertical CSS bars, in the shared
// admin panel. No points in the period: one sentence, no bars.

import { useTranslations } from 'next-intl';
import type { AdminReportsResponse } from '../hooks/useAdminReports';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import styles from '../AdminReportsPage.module.css';

interface UserGrowthChartProps {
  growth: AdminReportsResponse['growth'];
}

/* Aggregate daily points to at most 6 buckets: six dated labels still fit
   under the bars of a 390px phone. A bucket is named by its first day. */
/** `2026-09-25` → `25.09` (day first, as the rest of the panel writes dates). */
const dayLabel = (isoDate: string): string =>
  `${isoDate.slice(8, 10)}.${isoDate.slice(5, 7)}`;

function bucketsFromDailyPoints(
  points: AdminReportsResponse['growth']['new_users_per_day'],
  maxBuckets = 6
): Array<{ label: string; value: number }> {
  if (points.length === 0) {
    return [];
  }
  if (points.length <= maxBuckets) {
    return points.map(p => ({
      label: dayLabel(p.date),
      value: p.count,
    }));
  }

  const bucketSize = Math.ceil(points.length / maxBuckets);
  const result: Array<{ label: string; value: number }> = [];

  for (let i = 0; i < points.length; i += bucketSize) {
    const slice = points.slice(i, i + bucketSize);
    const total = slice.reduce((s, p) => s + p.count, 0);
    const label = dayLabel(slice[0]?.date ?? '');
    result.push({ label, value: total });
  }

  return result;
}

export function UserGrowthChartOrganism({ growth }: UserGrowthChartProps) {
  const t = useTranslations('admin.reports');
  const buckets = bucketsFromDailyPoints(growth.new_users_per_day);
  const maxVal = Math.max(...buckets.map(b => b.value), 1);
  const totalNew = buckets.reduce((s, b) => s + b.value, 0);
  // „7 dni" = suma ostatnich siedmiu punktów DZIENNYCH, nie wartość ostatniego
  // kubełka (kubełek to kilka dni zlepionych do max 8 słupków).
  const last7Days = growth.new_users_per_day
    .slice(-7)
    .reduce((s, p) => s + p.count, 0);

  return (
    <AdminPanelMolecule
      title={t('userGrowthTitle')}
      note={t('userGrowthNote', { total: totalNew, last7: last7Days })}>
      {totalNew > 0 ? (
        <>
          <div className={styles.chartBarGroup}>
            {buckets.map((b, idx) => (
              <div
                key={b.label}
                className={styles.chartBar}
                style={{
                  height: `${Math.max((b.value / maxVal) * 100, 3)}%`,
                  background: 'var(--color-info)',
                  animationDelay: `${idx * 40}ms`,
                }}
                title={t('growthBarTitle', { label: b.label, value: b.value })}
              />
            ))}
          </div>
          {/* Every bar has its label: the day it starts on and its count. */}
          <div className={styles.chartLabelsRow}>
            {buckets.map(b => (
              <span key={b.label} className={styles.chartLabelCell}>
                <span className={styles.chartLabelName}>{b.label}</span>
                <span className={styles.chartLabelValue}>{b.value}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className={styles.emptyState}>{t('noGrowthData')}</p>
      )}
    </AdminPanelMolecule>
  );
}

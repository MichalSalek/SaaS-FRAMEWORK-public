// UI/features/admin/components/ChurnRateChart.organism.tsx
// Disabled and deleted accounts, this period against the previous one, as
// vertical CSS bars in the shared admin panel. Four zeros: one sentence.

import { useLocale, useTranslations } from 'next-intl';
import type { AdminReportsResponse } from '../hooks/useAdminReports';
import { formatCount, formatSignedPercent } from '../reports-format';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import styles from '../AdminReportsPage.module.css';

interface ChurnRateChartProps {
  churn: AdminReportsResponse['churn'];
}

export function ChurnRateChartOrganism({ churn }: ChurnRateChartProps) {
  const t = useTranslations('admin.reports');
  const locale = useLocale();
  const bars = [
    {
      label: t('disabled'),
      sublabel: t('current'),
      value: churn.disabled_in_period.current,
      color: 'var(--color-warning)',
      opacity: 1,
    },
    {
      label: t('disabled'),
      sublabel: t('previous'),
      value: churn.disabled_in_period.previous,
      color: 'var(--color-warning)',
      opacity: 0.5,
    },
    {
      label: t('deleted'),
      sublabel: t('current'),
      value: churn.deleted_in_period.current,
      color: 'var(--color-error)',
      opacity: 1,
    },
    {
      label: t('deleted'),
      sublabel: t('previous'),
      value: churn.deleted_in_period.previous,
      color: 'var(--color-error)',
      opacity: 0.5,
    },
  ];

  const maxVal = Math.max(...bars.map(b => b.value), 1);

  // DECISION (nie usuwaj tego komentarza) — przegląd S126: zmiana liczona od
  // zera albo do zera nie jest procentem, z którego da się skorzystać
  // („Dezaktywowani: -100,0%” przy zerze kont). Procent pada tylko wtedy, gdy
  // OBA okresy mają wartość; inaczej „brak porównania”.
  const formatChange = (pair: {
    current: number;
    previous: number;
    change_percent: number | null;
  }) =>
    pair.change_percent === null || pair.previous === 0 || pair.current === 0
      ? t('changeUnknown')
      : formatSignedPercent(pair.change_percent, locale);

  return (
    <AdminPanelMolecule
      title={t('churnTitle')}
      note={`${t('disabled')}: ${formatChange(churn.disabled_in_period)}, ${t('deleted')}: ${formatChange(churn.deleted_in_period)}`}>
      {bars.every(b => b.value === 0) ? (
        <p className={styles.emptyState}>{t('churnEmpty')}</p>
      ) : (
        <>
          <div className={styles.chartBarGroup}>
            {bars.map((b, idx) => (
              <div
                key={`${b.label}-${b.sublabel}`}
                className={styles.chartBar}
                style={{
                  height: `${Math.max((b.value / maxVal) * 100, 3)}%`,
                  background: b.color,
                  opacity: b.opacity,
                  animationDelay: `${idx * 60}ms`,
                }}
                title={`${b.label} ${b.sublabel}: ${b.value}`}
              />
            ))}
          </div>
          <div className={styles.chartLabelsRow}>
            <span className={styles.chartLabelCell}>
              <span className={styles.chartLabelName}>{t('disabled')}</span>
              <span className={styles.chartLabelValue}>
                {formatCount(churn.disabled_in_period.current, locale)}
              </span>
            </span>
            <span className={styles.chartLabelCell}>
              <span className={styles.chartLabelName}>{t('deleted')}</span>
              <span className={styles.chartLabelValue}>
                {formatCount(churn.deleted_in_period.current, locale)}
              </span>
            </span>
          </div>
        </>
      )}
    </AdminPanelMolecule>
  );
}

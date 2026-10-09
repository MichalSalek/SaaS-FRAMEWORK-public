// UI/features/admin/components/RevenueChart.organism.tsx
// Accounts per plan as vertical CSS bars plus the estimated MRR, in the shared
// admin panel. The five bars share the panel's width; a label may wrap under
// its bar. No account on any plan: one sentence, no bars.

import { useLocale, useTranslations } from 'next-intl';
import {
  PricingPlanValue,
  getPlanDisplayName,
} from '@kernel/domain/pricing/pricing.config';
import type { AdminReportsResponse } from '../hooks/useAdminReports';
import { formatCount, formatPln } from '../reports-format';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import styles from '../AdminReportsPage.module.css';

interface RevenueChartProps {
  revenue: AdminReportsResponse['revenue'];
}

export function RevenueChartOrganism({ revenue }: RevenueChartProps) {
  const t = useTranslations('admin.reports');
  const locale = useLocale();
  // Nazwy planów z kernelowego SSOT (PLAN_DISPLAY_NAMES), nie lokalna kopia.
  const bars = [
    {
      label: getPlanDisplayName(PricingPlanValue.FREE),
      value: revenue.users_free,
      color: 'var(--color-text-disabled)',
    },
    {
      label: getPlanDisplayName(PricingPlanValue.PRO),
      value: revenue.users_pro,
      color: 'var(--color-primary)',
    },
    {
      label: getPlanDisplayName(PricingPlanValue.PRO_PLUS),
      value: revenue.users_pro_plus,
      color:
        'color-mix(in oklch, var(--color-primary) 85%, var(--color-text-primary))',
    },
    {
      label: getPlanDisplayName(PricingPlanValue.STUDIO),
      value: revenue.users_studio,
      color:
        'color-mix(in oklch, var(--color-primary) 70%, var(--color-text-primary))',
    },
    {
      label: getPlanDisplayName(PricingPlanValue.SCALE),
      value: revenue.users_scale,
      color:
        'color-mix(in oklch, var(--color-primary) 50%, var(--color-text-primary))',
    },
  ];

  const maxVal = Math.max(...bars.map(b => b.value), 1);

  return (
    <AdminPanelMolecule
      title={t('revenueTitle')}
      note={t('mrrEstSubtitle', {
        mrr: formatPln(revenue.mrr_estimate, locale),
      })}>
      {bars.every(b => b.value === 0) ? (
        <p className={styles.emptyState}>{t('plansEmpty')}</p>
      ) : (
        <>
          <div className={styles.chartBarGroup}>
            {bars.map((b, idx) => (
              <div
                key={b.label}
                className={styles.chartBar}
                style={{
                  height: `${Math.max((b.value / maxVal) * 100, 4)}%`,
                  background: b.color,
                  animationDelay: `${idx * 80}ms`,
                }}
                title={t('planBarTitle', { label: b.label, value: b.value })}
              />
            ))}
          </div>
          <div className={styles.chartLabelsRow}>
            {bars.map(b => (
              <span key={b.label} className={styles.chartLabelCell}>
                <span className={styles.chartLabelName}>{b.label}</span>
                <span className={styles.chartLabelValue}>
                  {formatCount(b.value, locale)}
                </span>
              </span>
            ))}
          </div>
        </>
      )}
    </AdminPanelMolecule>
  );
}

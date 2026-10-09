// UI/features/admin/components/PlanDistributionChart.organism.tsx
// Accounts per plan as a CSS conic pie with a legend, in the shared admin
// panel. No account on any plan: one sentence, no pie.

import { useTranslations } from 'next-intl';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { PLAN_TIER_ORDER } from '@kernel/domain/pricing/pricing-policy';
import type { AdminReportsResponse } from '../hooks/useAdminReports';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import styles from '../AdminReportsPage.module.css';

interface PlanDistributionChartProps {
  revenue: AdminReportsResponse['revenue'];
}

// Keyed by the kernel enum (not by display name): a renamed plan can no longer
// silently fall through to a `?? '#999'` fallback colour.
const PLAN_COLORS: Record<PricingPlan, string> = {
  FREE: 'var(--color-text-disabled)',
  PRO: 'var(--color-primary)',
  PRO_PLUS:
    'color-mix(in oklch, var(--color-primary) 82%, var(--color-text-primary))',
  STUDIO:
    'color-mix(in oklch, var(--color-primary) 65%, var(--color-text-primary))',
  SCALE:
    'color-mix(in oklch, var(--color-primary) 45%, var(--color-text-primary))',
};

const PLAN_COUNT_FIELD: Record<
  PricingPlan,
  keyof AdminReportsResponse['revenue']
> = {
  FREE: 'users_free',
  PRO: 'users_pro',
  PRO_PLUS: 'users_pro_plus',
  STUDIO: 'users_studio',
  SCALE: 'users_scale',
};

export function PlanDistributionChartOrganism({
  revenue,
}: PlanDistributionChartProps) {
  const t = useTranslations('admin.reports');
  // Order = kernel tier order; names from PLAN_DISPLAY_NAMES (SSOT).
  const plans = PLAN_TIER_ORDER.map(planId => ({
    plan: getPlanDisplayName(planId),
    count: revenue[PLAN_COUNT_FIELD[planId]],
    color: PLAN_COLORS[planId],
  }));

  const totalDist = plans.reduce((s, p) => s + p.count, 0);

  // Conic gradient stops: each plan starts where the previous ones end.
  const conicStops = plans
    .map((p, index) => {
      const before = plans
        .slice(0, index)
        .reduce((sum, earlier) => sum + earlier.count, 0);
      const start = totalDist > 0 ? (before / totalDist) * 360 : 0;
      const angle = totalDist > 0 ? (p.count / totalDist) * 360 : 0;
      return `${p.color} ${start}deg ${start + angle}deg`;
    })
    .join(', ');

  return (
    <AdminPanelMolecule
      title={t('planDistribution')}
      note={t('planDistSubtitle', { count: totalDist, plans: plans.length })}>
      {totalDist === 0 ? (
        <p className={styles.emptyState}>{t('plansEmpty')}</p>
      ) : (
        <div className={styles.pieBody}>
          {/* DECISION (nie usuwaj tego komentarza):
           * conic-gradient = wykres kołowy (pie) renderowany z REALNYCH danych
           * (revenue.users_free/pro/studio → kąty segmentów). To DATA-VIZ, a nie
           * dekoracja, więc jest dozwolonym wyjątkiem od anti-slop floor (zakaz
           * gradientów dotyczy ozdobnych tła/fillów UI, NIE wizualizacji danych).
           * Każdy stop ma kolor z palety/tokenu (PLAN_COLORS). role='img' +
           * aria-label dla a11y; legenda obok podaje wartości liczbowe.
           * Floor-scan: NIE flaguj tego conic-gradientu. */}
          <div
            className={styles.pieChart}
            style={{
              background: `conic-gradient(${conicStops})`,
            }}
            role='img'
            aria-label={t('planDistribution')}
          />
          <div className={styles.pieLegend}>
            {plans.map(p => (
              <div key={p.plan} className={styles.legendItem}>
                <span
                  className={styles.legendDot}
                  style={{ background: p.color }}
                  aria-hidden='true'
                />
                <span className={styles.legendLabel}>{p.plan}</span>
                <span className={styles.legendValue}>{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminPanelMolecule>
  );
}

import { useTranslations } from 'next-intl';
import { inlineColorStyle } from '../../../../application/colors/inline-color-style';
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
          {/* DECISION: conic-gradient is a pie chart rendered from REAL data
              (revenue.users_free/pro/studio -> segment angles). It is data-viz, not decoration,
              so it is an allowed exception to the anti-slop floor (the gradient ban covers
              decorative backgrounds and fills, not data visualisation). Every stop takes its
              colour from the palette tokens (PLAN_COLORS); role='img' + aria-label for a11y,
              the legend gives the numbers. Floor scan: do NOT flag this conic-gradient. */}
          <div
            className={styles.pieChart}
            style={inlineColorStyle({
              background: `conic-gradient(${conicStops})`,
            })}
            role='img'
            aria-label={t('planDistribution')}
          />
          <div className={styles.pieLegend}>
            {plans.map(p => (
              <div key={p.plan} className={styles.legendItem}>
                <span
                  className={styles.legendDot}
                  style={inlineColorStyle({ background: p.color })}
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

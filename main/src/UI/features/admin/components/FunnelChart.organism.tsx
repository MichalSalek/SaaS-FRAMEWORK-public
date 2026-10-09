// UI/features/admin/components/FunnelChart.organism.tsx
// Conversion funnel (sign-ups, active accounts, paid accounts) as horizontal
// CSS bars in the shared admin panel. No sign-ups: one sentence, no bars.

import { useLocale, useTranslations } from 'next-intl';
import type { AdminReportsResponse } from '../hooks/useAdminReports';
import { formatCount } from '../reports-format';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import styles from '../AdminReportsPage.module.css';

interface FunnelChartProps {
  funnel: AdminReportsResponse['funnel'];
  growth: AdminReportsResponse['growth'];
}

export function FunnelChartOrganism({ funnel }: FunnelChartProps) {
  const t = useTranslations('admin.reports');
  const locale = useLocale();
  // Lejek z REALNYCH danych: rejestracje = 100% baseline. Dawny krok „Wizyty"
  // był proxy z sumy nowych użytkowników (czyli znów rejestracjami), więc dwa
  // pierwsze słupki były zawsze ~równe — wykres udawał metrykę, której nie ma.
  const registrations = funnel.total_registrations.current;
  const active = funnel.active_accounts.current;
  const paid = funnel.paid_accounts.current;
  const base = registrations > 0 ? registrations : 1;

  const steps = [
    {
      label: t('signup'),
      value: registrations,
      pct: registrations > 0 ? 100 : 0,
    },
    {
      label: t('onboard'),
      value: active,
      pct: Math.min(100, Math.round((active / base) * 100)),
    },
    {
      label: t('activePaid'),
      value: paid,
      pct: Math.min(100, Math.round((paid / base) * 100)),
    },
  ];

  return (
    <AdminPanelMolecule title={t('funnelTitle')} note={t('funnelSubtitle')}>
      {registrations === 0 ? (
        <p className={styles.emptyState}>{t('funnelEmpty')}</p>
      ) : (
        <div className={styles.funnelBody}>
          {steps.map((step, idx) => (
            <div key={step.label} className={styles.funnelStep}>
              <span className={styles.funnelLabel}>{step.label}</span>
              <div className={styles.funnelBarTrack}>
                <div
                  className={styles.funnelBar}
                  style={{
                    width: `${step.pct}%`,
                    opacity: 0.45 + (step.pct / 100) * 0.55,
                    transitionDelay: `${idx * 80}ms`,
                  }}
                />
              </div>
              <span className={styles.funnelValue}>
                {formatCount(step.value, locale)}
              </span>
            </div>
          ))}
        </div>
      )}
    </AdminPanelMolecule>
  );
}

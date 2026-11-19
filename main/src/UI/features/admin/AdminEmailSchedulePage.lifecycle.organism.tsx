import styles from './AdminEmailSchedulePage.module.css';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { useLocale, useTranslations } from 'next-intl';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

type EmailPipeline = ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PIPELINE']['RESPONSE'];
type AdminFreeEmailCandidate = EmailPipeline['free']['candidates'][number];
type AdminLifecycleEmailHistory = EmailPipeline['lifecycle']['history'][number];
import { formatTimestamp } from '../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import { EventLabelMolecule } from './AdminEmailSchedulePage.labels.molecule';
import {
  TRIAL_EMAIL_SCHEDULE,
  CANCEL_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  WINBACK_DELETION_RULE,
} from '@kernel/domain/email/email-schedule.config';

const historyRules = [
  ...TRIAL_EMAIL_SCHEDULE,
  ...CANCEL_EMAIL_SCHEDULE,
  ONBOARDING_ABANDONMENT_RULE,
  WINBACK_DELETION_RULE,
];

export function LifecycleEmailPipelineOrganism({
  pipeline,
}: {
  pipeline: EmailPipeline;
}) {
  const t = useTranslations('admin.emailSchedule.lifecycle');
  const locale = useLocale();
  const label = (
    group: 'mails' | 'reasons' | 'statuses' | 'cohorts',
    code: string | null
  ) => {
    if (code === null) {
      return t('noData');
    }
    const key = `${group}.${code}`;
    return t.has(key) ? t(key) : code;
  };
  const date = (iso: string | null) =>
    iso ? formatTimestamp(iso, locale) : t('noDate');
  const candidates: DataTableColumn<AdminFreeEmailCandidate>[] = [
    {
      id: 'account',
      header: t('columnAccount'),
      priority: 'primary',
      width: 'minmax(0,1.4fr)',
      cell: row => row.email || row.userId || row.enrollmentId,
    },
    {
      id: 'cohort',
      header: t('columnCohort'),
      priority: 'meta',
      width: 'minmax(0,1fr)',
      labelInCard: true,
      cell: row => label('cohorts', row.cohort),
    },
    {
      id: 'mail',
      header: t('columnMail'),
      priority: 'secondary',
      width: 'minmax(0,1fr)',
      cell: row => label('mails', row.templateId),
    },
    {
      id: 'planned',
      header: t('columnPlanned'),
      priority: 'meta',
      width: 'minmax(0,1fr)',
      labelInCard: true,
      cell: row => date(row.plannedAt),
    },
    {
      id: 'decision',
      header: t('columnDecision'),
      priority: 'secondary',
      width: 'minmax(0,1.4fr)',
      labelInCard: true,
      cell: row => label('reasons', row.reason),
    },
  ];
  const history: DataTableColumn<AdminLifecycleEmailHistory>[] = [
    {
      id: 'mail',
      header: t('columnMail'),
      priority: 'primary',
      width: 'minmax(0,1.4fr)',
      cell: row => {
        const rule = historyRules.find(rule => rule.id === row.ruleId);
        return rule ? (
          <EventLabelMolecule name={rule.infoEvent} />
        ) : (
          label('mails', row.ruleId)
        );
      },
    },
    {
      id: 'cohort',
      header: t('columnCohort'),
      priority: 'meta',
      width: 'minmax(0,1fr)',
      labelInCard: true,
      cell: row => label('cohorts', row.cohort),
    },
    {
      id: 'planned',
      header: t('columnPlanned'),
      priority: 'meta',
      width: 'minmax(0,1fr)',
      labelInCard: true,
      cell: row => date(row.plannedAt),
    },
    {
      id: 'status',
      header: t('columnStatus'),
      priority: 'secondary',
      width: 'minmax(0,1fr)',
      cell: row => label('statuses', row.status),
    },
    {
      id: 'delivery',
      header: t('columnDelivery'),
      priority: 'secondary',
      width: 'minmax(0,1fr)',
      cell: row => label('statuses', row.deliveryStatus),
    },
    {
      id: 'reason',
      header: t('columnReason'),
      priority: 'secondary',
      width: 'minmax(0,1.4fr)',
      cell: row => (row.reason ? label('reasons', row.reason) : t('noData')),
    },
    {
      id: 'provider',
      header: t('columnProvider'),
      priority: 'meta',
      width: 'minmax(0,1fr)',
      labelInCard: true,
      cell: row => row.provider ?? t('noData'),
    },
  ];
  const metrics = [
    'accepted',
    'delivered',
    'delayed',
    'bounced',
    'complained',
    'unknown',
    'rejected',
    'suppressed',
  ] as const;
  return (
    <>
      <AdminPanelMolecule
        title={t('freeTitle')}
        aside={t(`modes.${pipeline.free.mode}`)}
        note={t('previewScope')}
        footer={
          <>
            <span>
              {t('enrolled', { count: pipeline.free.enrolled })}{' '}
              {t('started', { date: date(pipeline.free.startedAt) })}
            </span>
            <LinkButtonAtom
              variant='outlined'
              size='sm'
              href={ROUTES_FRONT.ADMIN_CONFIG}>
              {t('configure')}
            </LinkButtonAtom>
          </>
        }>
        <DataTableOrganism
          surface='flush'
          caption={t('freeTitle')}
          columns={candidates}
          rows={pipeline.free.candidates}
          rowKey={row => row.enrollmentId}
          state={pipeline.free.candidates.length ? 'ready' : 'empty'}
          empty={t('empty')}
        />
      </AdminPanelMolecule>
      <p className={styles.panelNote}>{t('operationalTitle')}</p>
      <StatTileBandMolecule ariaLabel={t('operationalTitle')}>
        {metrics.map(metric => (
          <StatTileMolecule
            key={metric}
            label={t(`statuses.${metric}`)}
            value={new Intl.NumberFormat(locale).format(
              pipeline.lifecycle[metric]
            )}
          />
        ))}
      </StatTileBandMolecule>
      <AdminPanelMolecule title={t('historyTitle')} note={t('deliveryNote')}>
        <DataTableOrganism
          surface='flush'
          caption={t('historyTitle')}
          columns={history}
          rows={pipeline.lifecycle.history}
          rowKey={row => row.id}
          state={pipeline.lifecycle.history.length ? 'ready' : 'empty'}
          empty={t('historyEmpty')}
        />
      </AdminPanelMolecule>
    </>
  );
}

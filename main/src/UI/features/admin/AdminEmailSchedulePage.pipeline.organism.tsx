// UI/features/admin/AdminEmailSchedulePage.pipeline.organism.tsx
// What the sweep does now, on the email schedule page: one band of numbers
// (last sweep, sweeps in 7 days, first-month codes) and the dry-run queue for
// today and tomorrow. Nothing here sends mail; the backend runs the sweep's
// own resolvers.

import { useLocale, useTranslations } from 'next-intl';
import { PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { adminUserHref } from '@kernel/domain/admin/admin-users-url.config';
import type { AdminEmailPipelineSend } from '@kernel/models/admin/admin-mailing.dto';
import { formatTimestamp } from '../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import { useAdminEmailPipeline } from './hooks/useAdminEmailPipeline';
import { EventLabelMolecule } from './AdminEmailSchedulePage.labels.molecule';
import styles from './AdminEmailSchedulePage.module.css';

/** A timestamp as two pieces (date, time): the tile may put the time on a
 *  second line, but neither piece ever breaks inside. */
function TimestampValue({ iso, locale }: { iso: string; locale: string }) {
  const text = formatTimestamp(iso, locale);
  const cut = text.lastIndexOf(', ');
  if (cut === -1) {
    return <span className={styles.nowrap}>{text}</span>;
  }
  return (
    <>
      <span className={styles.nowrap}>{text.slice(0, cut + 1)}</span>{' '}
      <span className={styles.nowrap}>{text.slice(cut + 2)}</span>
    </>
  );
}

export function EmailPipelineOrganism() {
  const t = useTranslations('admin.emailSchedule.pipeline');
  const locale = useLocale();
  const { pipeline, isLoading, isFetching, isError, refetch } =
    useAdminEmailPipeline();
  const numberFormat = new Intl.NumberFormat(locale);

  const error = isError ? (
    <ErrorStateMolecule
      message={t('loadError')}
      retryLabel={t('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  ) : null;

  // Nothing read: „no sweep on record" and „nobody waiting" would be guesses,
  // so the numbers and the queue step aside for the error. A failed refresh
  // keeps the last read under the error.
  if (isError && pipeline === null) {
    return error;
  }

  const offers = pipeline?.offers ?? null;
  // The sweep has left no trace at all: ONE sentence instead of three tiles
  // of zeros above an empty list. An unreadable Stripe is not „no codes", so
  // it keeps the tiles.
  const isIdle =
    pipeline !== null &&
    pipeline.lastSweepAt === null &&
    pipeline.sweepsLast7Days === 0 &&
    pipeline.queue.length === 0 &&
    offers !== null &&
    offers.issued === 0;

  const columns: DataTableColumn<AdminEmailPipelineSend>[] = [
    {
      id: 'email',
      header: t('columnEmail'),
      priority: 'primary',
      width: 'minmax(0, 1.4fr)',
      cell: send => send.email,
    },
    {
      id: 'mail',
      header: t('columnMail'),
      priority: 'secondary',
      width: 'minmax(0, 1.6fr)',
      cell: send => <EventLabelMolecule name={send.infoEvent} />,
    },
    {
      id: 'due',
      header: t('columnDue'),
      priority: 'meta',
      // Fits the longest word („Tomorrow”, „Morgen”).
      width: '6rem',
      labelInCard: true,
      cell: send => (send.due === 'today' ? t('dueToday') : t('dueTomorrow')),
    },
  ];

  return (
    <>
      {error}
      {isIdle ? (
        <AdminPanelMolecule
          title={t('title')}
          footer={<p className={styles.panelNote}>{t('note')}</p>}>
          <EmptyStateAtom
            size='panel'
            icon={<PaperPlaneTiltIcon size={28} weight='duotone' />}
            title={t('idleTitle')}
            titleAs='h3'
            description={t('idleBody')}
          />
        </AdminPanelMolecule>
      ) : (
        <>
          <StatTileBandMolecule ariaLabel={t('title')}>
            <StatTileMolecule
              label={t('lastSweep')}
              loading={isLoading}
              value={
                pipeline?.lastSweepAt ? (
                  <TimestampValue iso={pipeline.lastSweepAt} locale={locale} />
                ) : (
                  t('lastSweepNone')
                )
              }
              {...(pipeline !== null &&
                pipeline.lastSweepAt !== null &&
                pipeline.lastSweepEmailsSent !== null && {
                  hint: t('lastSweepSent', {
                    count: pipeline.lastSweepEmailsSent,
                  }),
                })}
            />
            <StatTileMolecule
              label={t('sweeps7d')}
              loading={isLoading}
              value={numberFormat.format(pipeline?.sweepsLast7Days ?? 0)}
            />
            <StatTileMolecule
              label={t('offers')}
              loading={isLoading}
              value={
                offers !== null
                  ? numberFormat.format(offers.issued)
                  : t('offersUnavailable')
              }
              {...(offers !== null && {
                hint: t('offersHint', {
                  redeemed: numberFormat.format(offers.redeemed),
                  active: numberFormat.format(offers.active),
                }),
              })}
            />
          </StatTileBandMolecule>

          <AdminPanelMolecule
            title={t('queueCaption')}
            // Always mounted: the count arriving moves nothing.
            aside={
              pipeline !== null
                ? t('queueCount', { count: pipeline.queue.length })
                : null
            }
            footer={<p className={styles.panelNote}>{t('note')}</p>}>
            <DataTableOrganism
              surface='flush'
              caption={t('queueCaption')}
              columns={columns}
              rows={pipeline?.queue ?? []}
              rowKey={send => `${send.due}:${send.userId}:${send.ruleId}`}
              rowHref={send =>
                adminUserHref({ search: send.userId, userId: send.userId })
              }
              rowLabel={send => t('openUserAria', { email: send.email })}
              state={
                isLoading
                  ? 'loading'
                  : pipeline === null || pipeline.queue.length === 0
                    ? 'empty'
                    : 'ready'
              }
              skeletonRows={4}
              empty={t('empty')}
            />
          </AdminPanelMolecule>
        </>
      )}
    </>
  );
}

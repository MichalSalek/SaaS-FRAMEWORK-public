// UI/features/admin/AdminEmailSchedulePage.composition.tsx
// Admin read-only view of the lifecycle mail: what the sweep does now (numbers
// and the dry-run queue, AdminEmailSchedulePage.pipeline.organism.tsx) and the
// two rule lists, trial and cancel (AdminEmailSchedulePage.tables.organism.tsx).
// Every list is the shared DataTable, every number a StatTile.

import { useTranslations } from 'next-intl';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useAdminEmailSchedule } from './hooks/useAdminEmailSchedule';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { EmailPipelineOrganism } from './AdminEmailSchedulePage.pipeline.organism';
import {
  CancelTableOrganism,
  TrialTableOrganism,
} from './AdminEmailSchedulePage.tables.organism';

export function AdminEmailSchedulePageComposition() {
  const t = useTranslations('admin.emailSchedule');
  const { schedule, cancelSchedule, isLoading, isFetching, isError, refetch } =
    useAdminEmailSchedule();
  const queryClient = useQueryClient();
  const isPipelineFetching =
    useIsFetching({ queryKey: queryKeys.admin.emailPipeline }) > 0;
  // Nothing was read: the lists would say „no e-mails configured", which is
  // a guess. They step aside and the error speaks for them. A failed refresh
  // keeps the rows it had under the error.
  const scheduleUnknown =
    isError && schedule === null && cancelSchedule === null;

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='outlined'
          icon={<ArrowClockwiseIcon size={14} />}
          loading={isFetching || isPipelineFetching}
          onClick={() => {
            void refetch();
            void queryClient.invalidateQueries({
              queryKey: queryKeys.admin.emailPipeline,
            });
          }}>
          {t('refresh')}
        </ButtonAtom>
      }>
      {/* What the sweep does now: last run, codes, today's and tomorrow's queue */}
      <EmailPipelineOrganism />

      {isError && (
        <ErrorStateMolecule
          message={t('loadError')}
          retryLabel={t('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      )}
      {!scheduleUnknown && (
        <>
          <TrialTableOrganism rows={schedule} isLoading={isLoading} t={t} />
          <CancelTableOrganism
            rows={cancelSchedule}
            isLoading={isLoading}
            t={t}
          />
        </>
      )}
    </AdminPageLayoutComposition>
  );
}

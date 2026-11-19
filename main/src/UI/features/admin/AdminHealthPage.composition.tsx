// UI/features/admin/AdminHealthPage.composition.tsx
// Admin system health: the verdict with the list of services, the runtime and
// e-mail numbers, the latest errors. Polled every minute.
// Parts: .services.organism.tsx (verdict + services), .widgets.organism.tsx
// (numbers + errors). The reading of the snapshot is admin-health.model.ts.

import { useTranslations } from 'next-intl';
import { ArrowClockwiseIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import {
  useAdminHealth,
  HEALTH_REFETCH_INTERVAL_MS,
} from './hooks/useAdminHealth';
import { HealthServicesOrganism } from './AdminHealthPage.services.organism';
import { readHealthVerdict } from './admin-health.model';
import {
  HealthEmailOrganism,
  HealthPerformanceOrganism,
  RecentErrorsPanelOrganism,
} from './AdminHealthPage.widgets.organism';

export function AdminHealthPageComposition() {
  const t = useTranslations('admin.health');
  const { health, isFetching, isError, refetch } = useAdminHealth();
  const snapshot = health ?? null;

  // The wait shows IN the button, which keeps its width.
  const refreshButton = (
    <ButtonAtom
      size='sm'
      variant='outlined'
      icon={<ArrowClockwiseIcon size={14} />}
      onClick={() => void refetch()}
      loading={isFetching}>
      {t('refresh')}
    </ButtonAtom>
  );

  // Derived from the poll SSOT so the displayed cadence can never drift from
  // the real refetchInterval (anti-display-lie).
  const intervalSeconds = HEALTH_REFETCH_INTERVAL_MS / 1000;
  // A failed poll: the page stops claiming „live” (what stands below is then
  // the LAST GOOD read) and says the refresh failed above it.
  const livePill = isError ? undefined : (
    <StatusPillAtom
      color='var(--color-success)'
      pulse
      label={t('refreshInterval', { seconds: intervalSeconds })}
    />
  );
  const loadError = isError ? (
    <ErrorStateMolecule
      message={t('loadError')}
      retryLabel={t('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  ) : null;

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={refreshButton}
      meta={livePill}>
      {loadError}
      {/* A failed FIRST read has nothing to show under the error. While the
          first read is on its way every part draws its own final geometry
          (labels stand, values wait), so the answer moves nothing. */}
      {isError && snapshot === null ? null : (
        <>
          <HealthServicesOrganism
            verdict={snapshot === null ? null : readHealthVerdict(snapshot)}
          />
          <HealthPerformanceOrganism health={snapshot} />
          <HealthEmailOrganism health={snapshot} />
          <RecentErrorsPanelOrganism health={snapshot} />
        </>
      )}
    </AdminPageLayoutComposition>
  );
}

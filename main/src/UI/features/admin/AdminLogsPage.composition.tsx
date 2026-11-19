// UI/features/admin/AdminLogsPage.composition.tsx
// Application log browser: occurrence stream + error-class view with triage.
// State and data: hooks/useAdminLogsPage.
//
// DECISION: the TODAY layout won the owner vote: title block, filters, list, pagination,
// details panel. Both lists stand on the shared primitives (DataTable, Pagination, FilterBar)
// because tables cut off at the phone's right edge were a defect measured independently of the
// vote. (owner)

import { useTranslations } from 'next-intl';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useAdminLogsPage } from './hooks/useAdminLogsPage';
import {
  LogsStatsStripMolecule,
  VerboseTogglePill,
} from './AdminLogsPage.parts.molecule';
import { AdminLogsStreamOrganism } from './AdminLogsStream.organism';
import { AdminLogsFiltersMolecule } from './AdminLogsPage.filters.molecule';
import { AdminLogGroupsOrganism } from './AdminLogGroups.organism';
import { LogDetailsSheetOrganism } from './components/LogDetailsSheet.organism';
import { AdminScopeChipMolecule } from './components/AdminScopeChip.molecule';
import {
  ADMIN_ATTENTION_COPY_VALUES,
  ADMIN_ATTENTION_SIGNALS,
} from './admin-attention.config';

const LOG_SIGNAL = ADMIN_ATTENTION_SIGNALS.log_issues_open;

export function AdminLogsPageComposition() {
  const t = useTranslations('admin.logs');
  const tAttention = useTranslations('admin.attention');
  const page = useAdminLogsPage();
  const { view, attention, stream, groups } = page;

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <VerboseTogglePill
          verboseOn={page.verbose.on}
          toggling={page.verbose.toggling}
          loading={page.verbose.loading}
          unknown={page.verbose.unknown}
          onToggle={page.verbose.toggle}
        />
      }>
      {/* DECISION: an error does not remove the filters. When the whole page (filters included)
          gave way to the error, a filter that caused it (e.g. a date range) could no longer be
          changed or cleared, leaving only a retry loop. */}
      <>
        {attention ? (
          // List behind the „Logi N” badge: the server fixes the scope itself and ignores filters, so one
          // removable chip stands instead of them, and the number beside it is the one the menu shows.
          <AdminScopeChipMolecule
            label={tAttention(LOG_SIGNAL.scopeKey, ADMIN_ATTENTION_COPY_VALUES)}
            countLabel={
              groups.isKnown && !page.showError
                ? tAttention(LOG_SIGNAL.countLabelKey, {
                    count: groups.totalGroups,
                  })
                : null
            }
            onRemove={() => page.setAttention(false)}
          />
        ) : (
          <>
            {page.hideResults ? null : view === 'stream' ? (
              <LogsStatsStripMolecule
                totalCount={stream.totalCount}
                totalLabel={t('statTotalLabel')}
                pageCount={stream.records?.length ?? 0}
                pageLabel={t('statPageLabel')}
                oldestRecordDate={stream.oldestRecordDate}
              />
            ) : (
              // Groups: the total counts error CLASSES (it sat under „Wszystkich zdarzeń”, next to the page
              // count under „Klas błędów”: two tiles, both mislabelled).
              <LogsStatsStripMolecule
                totalCount={groups.totalGroups}
                totalLabel={t('statGroupsLabel')}
                pageCount={groups.rows.length}
                pageLabel={t('statPageLabel')}
                oldestRecordDate={null}
              />
            )}

            <AdminLogsFiltersMolecule
              view={view}
              onViewChange={page.setView}
              scope={page.scope}
              onScopeChange={page.setScope}
              local={page.local}
              onLocalChange={page.setLocal}
              activeQuickFilters={page.activeQuickFilters}
              onQuickFilterToggle={page.toggleQuickFilter}
              onClearAll={page.clearFilters}
            />
          </>
        )}

        {page.showError && (
          <ErrorStateMolecule
            message={t('loadError')}
            retryLabel={t('retry')}
            onRetry={page.retry}
            isRetrying={page.isRetrying}
          />
        )}
        {page.hideResults ? null : view === 'groups' ? (
          <AdminLogGroupsOrganism
            groups={groups.rows}
            isLoading={!page.isUrlReady || groups.isLoading}
            truncatedInfo={groups.truncatedInfo}
            onOpenLog={page.openLog}
            {...(attention && {
              caption: t('attentionListLabel'),
              emptyLabel: t('attentionEmpty'),
            })}
          />
        ) : (
          <AdminLogsStreamOrganism
            rows={stream.records ?? []}
            isLoading={!page.isUrlReady || stream.isLoading}
            isFetching={stream.isFetching}
            onOpenLog={page.openLog}
            pagination={page.pagination}
          />
        )}
      </>
      {page.logId !== null && (
        <LogDetailsSheetOrganism
          logId={page.logId}
          onOpenLog={page.openLog}
          onClose={page.closeLog}
        />
      )}
    </AdminPageLayoutComposition>
  );
}

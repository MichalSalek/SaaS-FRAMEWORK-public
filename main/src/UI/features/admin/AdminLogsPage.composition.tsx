// UI/features/admin/AdminLogsPage.composition.tsx
// Przeglądarka logów aplikacji: strumień wystąpień + widok klas błędów z triage'em.
// Stan i dane: hooks/useAdminLogsPage.
//
// DECISION (nie usuwaj tego komentarza) — głos ownera `s126-admin`,
// 2026-10-09: wygrał układ DZIŚ. Struktura strony zostaje: blok tytułu, filtry,
// lista, paginacja, panel szczegółów. Obie listy stoją na wspólnych
// prymitywach (DataTable, Pagination, FilterBar), bo tabele ucięte przy prawej
// krawędzi telefonu były wadą zmierzoną niezależnie od głosu.

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
      {/* DECISION (nie usuwaj tego komentarza): błąd NIE zdejmuje filtrów.
          Wcześniej cała strona (z filtrami) ustępowała komunikatowi błędu, więc
          filtr, który sam wywołał błąd (np. zakres dat), nie dał się już
          zmienić ani wyczyścić; zostawało tylko „Spróbuj ponownie" w pętli. */}
      <>
        {attention ? (
          // Lista spod badge „Logi N": serwer sam ustala zakres i ignoruje
          // filtry, więc zamiast nich stoi jeden zdejmowalny chip, a liczba
          // obok niego to ta sama liczba, którą pokazuje menu.
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
              // Groups: the total counts error CLASSES (it used to sit under
              // „Wszystkich zdarzeń”, next to the page count under „Klas
              // błędów”: two tiles, both mislabelled).
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

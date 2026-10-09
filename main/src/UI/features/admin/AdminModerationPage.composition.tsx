// UI/features/admin/AdminModerationPage.composition.tsx
// Admin content moderation: the queue of reports on cards with the reported
// picture, one status select with the count above and the shared pager below.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheckIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { PaginationMolecule } from '../../components/Pagination/Pagination.molecule';
import { AppSelectAtom } from '../../primitives/AppSelect.atom';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useModerationReports } from './hooks/useModerationReports';
import { useResolveReport } from './hooks/useResolveReport';
import { useApplyStrike } from './hooks/useApplyStrike';
import { ReportCardOrganism } from './ReportCard.organism';
import { ReportCardSkeletonMolecule } from './components/ReportCardSkeleton.molecule';
import {
  ContentReportStatus,
  ModerationAction as ModerationActionConst,
  type ModerationAction,
} from '@kernel/models/moderation/moderation.dto';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import styles from './AdminModerationPage.module.css';

type FilterTab = 'ALL' | ContentReportStatus;

const PAGE_SIZE = 20;

export function AdminModerationPageComposition() {
  const t = useTranslations('admin.moderation');
  const tButtons = useTranslations('buttons');
  const [activeTab, setActiveTab] = useState<FilterTab>(
    // The queue opens on what waits for a decision.
    ContentReportStatus.PENDING
  );
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const selectTab = (next: FilterTab) => {
    setActiveTab(next);
    setPage(1);
    setExpandedId(null);
  };

  const {
    reports,
    totalCount,
    isPlaceholderData,
    hasData,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useModerationReports(
    activeTab === 'ALL'
      ? { page, limit: PAGE_SIZE }
      : { status: activeTab, page, limit: PAGE_SIZE }
  );
  // Counts of the PREVIOUS tab/page stay on screen while the next one loads
  // (keepPreviousData); they must not be labelled as the new tab's total.
  const knownTotal = isPlaceholderData || !hasData ? null : totalCount;

  const resolveReport = useResolveReport();
  const applyStrike = useApplyStrike();

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Clamp `page` when the total shrinks — resolving the last report on the last
  // page drops totalPages below the current page, otherwise stranding the admin
  // on an empty page whose refetch is keyed to a page the server no longer has.
  // totalPages is always >= 1, so this never underflows.
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  // Per-card progress and failure: the mutations are shared, so a bare
  // isPending would mark the actions of every card, not the one acted on.
  const resolveTargetId = resolveReport.variables?.report_id ?? null;
  const strikeTargetId = applyStrike.variables?.report_id ?? null;
  const resolvingAction = (reportId: string): ModerationAction | null =>
    resolveReport.isPending && resolveTargetId === reportId
      ? (resolveReport.variables?.action ?? null)
      : null;
  const actionError = (reportId: string): string | null =>
    resolveReport.isError && resolveTargetId === reportId
      ? t('resolveError')
      : applyStrike.isError && strikeTargetId === reportId
        ? t('strikeError')
        : null;

  // Localized label for a moderation action — the raw enum (WARN/HIDE/...)
  // must never leak into the snackbar. Exhaustive switch: adding a new
  // ModerationAction without a label is a TS error.
  const actionLabel = (action: ModerationAction): string => {
    switch (action) {
      case ModerationActionConst.WARN:
        return t('actionLabel.WARN');
      case ModerationActionConst.HIDE:
        return t('actionLabel.HIDE');
      case ModerationActionConst.DELETE:
        return t('actionLabel.DELETE');
      case ModerationActionConst.BAN:
        return t('actionLabel.BAN');
      case ModerationActionConst.DISMISS:
        return t('actionLabel.DISMISS');
    }
  };

  // A failed decision is reported in the card, next to the buttons
  // (`actionError`); success leaves the card, so it is a snackbar.
  const handleResolve = (
    reportId: string,
    action: ModerationAction,
    adminNote: string
  ) => {
    resolveReport.mutate(
      adminNote
        ? { report_id: reportId, action, admin_note: adminNote }
        : { report_id: reportId, action },
      {
        onSuccess: data => {
          // Show the EFFECTIVE action from the response, not the requested
          // one — the backend downgrades destructive actions to WARN when the
          // gallery record is already gone (only the stale report gets closed).
          pushNewSnackbar(
            t('resolveSuccess', { action: actionLabel(data.action) }),
            'success'
          );
          setExpandedId(null);
        },
      }
    );
  };

  const handleStrike = (userId: string, reason: string, reportId: string) => {
    applyStrike.mutate(
      { user_id: userId, reason, report_id: reportId },
      {
        onSuccess: data => {
          const msg = data.ban_recommended
            ? t('strikeAppliedBan', { count: data.moderation_strikes })
            : t('strikeApplied', { count: data.moderation_strikes });
          pushNewSnackbar(msg, data.ban_recommended ? 'warning' : 'success');
        },
      }
    );
  };

  const error = (
    <ErrorStateMolecule
      message={t('loadErrorText')}
      retryLabel={tButtons('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  );

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('pageTitle')}
      subtitle={t('pageSubtitle')}>
      <div className={styles.page}>
        {/* DECISION (nie usuwaj tego komentarza) — przegląd S126: jedno pole
            wyboru to nie pasek filtrów. Wspólny pasek dawał mu trzy rzędy
            („Wyczyść filtry”, pole, licznik), a na telefonie chował je pod
            przyciskiem „Filtry”. Stoi więc JEDEN rząd: status i liczba
            zgłoszeń w tym statusie (jedyne miejsce, gdzie ta liczba pada).
            Zdanie jest zawsze zamontowane, więc zmiana statusu nie przesuwa
            listy. */}
        <div className={styles.filterRow}>
          <AppSelectAtom<FilterTab>
            aria-label={t('filterByStatus')}
            value={activeTab}
            onValueChange={selectTab}
            options={[
              { value: 'ALL', label: t('filterAll') },
              { value: ContentReportStatus.PENDING, label: t('filterPending') },
              {
                value: ContentReportStatus.APPROVED,
                label: t('filterApproved'),
              },
              {
                value: ContentReportStatus.REJECTED,
                label: t('filterRejected'),
              },
            ]}
          />
          <p className={styles.filterSummary} role='status'>
            {knownTotal !== null ? t('listSummary', { count: knownTotal }) : ''}
          </p>
        </div>

        {isLoading ? (
          <ReportCardSkeletonMolecule />
        ) : isError && (!hasData || reports.length === 0) ? (
          // An empty last read under a failed refetch is not a confirmed
          // empty queue: error with retry, never the "all clear" state.
          error
        ) : reports.length === 0 ? (
          <EmptyStateAtom
            icon={<ShieldCheckIcon size={32} weight='light' />}
            title={t('emptyTitle')}
            titleAs='h2'
            description={
              activeTab === ContentReportStatus.PENDING
                ? t('emptyPending')
                : t('emptyFilter')
            }
          />
        ) : (
          <>
            {/* Refresh after a decision failed: the queue below is the last
                good read, so say so instead of swapping it for an error. */}
            {isError && error}
            <div className={styles.reportsList}>
              {reports.map(report => (
                <ReportCardOrganism
                  key={report.id}
                  report={report}
                  isExpanded={expandedId === report.id}
                  onToggle={() =>
                    setExpandedId(prev =>
                      prev === report.id ? null : report.id
                    )
                  }
                  onResolve={(action, note) =>
                    handleResolve(report.id, action, note)
                  }
                  onStrike={(userId, reason) =>
                    handleStrike(userId, reason, report.id)
                  }
                  resolvingAction={resolvingAction(report.id)}
                  isStriking={
                    applyStrike.isPending && strikeTargetId === report.id
                  }
                  actionError={actionError(report.id)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <PaginationMolecule
                mode='pages'
                ariaLabel={t('paginationAriaLabel')}
                prevLabel={t('paginationPrev')}
                nextLabel={t('paginationNext')}
                summary={t('paginationInfo', { page, totalPages })}
                isBusy={isFetching}
                page={page}
                pageCount={totalPages}
                onPageChange={next => {
                  setPage(next);
                  setExpandedId(null);
                }}
                pageLabel={n => t('paginationPage', { page: n })}
              />
            )}
          </>
        )}
      </div>
    </AdminPageLayoutComposition>
  );
}

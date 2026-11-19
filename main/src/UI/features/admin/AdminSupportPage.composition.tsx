// UI/features/admin/AdminSupportPage.composition.tsx
// Admin support queue: the shared filter bar (search + status), the threads on
// the shared table and the shared pager. The menu badge „Wsparcie N” opens this
// page narrowed to exactly the threads it counts (scope chip).
//
// The search filters the LOADED threads client-side (no extra API); while the
// server has more, a button pulls the next page so the search reaches them too.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useUrlSyncedState } from '../../shared/hooks/useUrlSyncedState';
import {
  ADMIN_SUPPORT_URL_CODEC,
  DEFAULT_SUPPORT_TAB,
  type SupportFilterTab,
} from './support-filters.model';
import { AdminScopeChipMolecule } from './components/AdminScopeChip.molecule';
import { ADMIN_ATTENTION_SIGNALS } from './admin-attention.config';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { FilterBarMolecule } from '../../components/FilterBar/FilterBar.molecule';
import { HeroCountPillAtom } from '../../components/HeroCountPill/HeroCountPill.atom';
import { PaginationMolecule } from '../../components/Pagination/Pagination.molecule';
import { SelectAtom } from '../../components/Select/Select.atom';
import { useAdminSupportThreads } from './hooks/useAdminSupportThreads';
import { useAdminAttentionCounts } from './hooks/useAdminAttentionCounts';
import { AdminSupportThreadsOrganism } from './AdminSupportThreads.organism';
import styles from './AdminSupportPage.module.css';

type StatusTab = Exclude<SupportFilterTab, 'AWAITING'>;

const AWAITING_SIGNAL = ADMIN_ATTENTION_SIGNALS.support_awaiting_reply;

// One screen of the list = one server page (`take` in useAdminSupportThreads).
const PAGE_SIZE = 20;

export function AdminSupportPageComposition() {
  const t = useTranslations('admin.support');
  const tButtons = useTranslations('buttons');
  const tAttention = useTranslations('admin.attention');
  // The filter lives in the address: the „Wsparcie N” menu badge opens this page with
  // `filter=awaiting`, and refresh and „back" return to the same view.
  const [urlState, setUrlState, isUrlReady] = useUrlSyncedState(
    ADMIN_SUPPORT_URL_CODEC
  );
  const { tab } = urlState;
  const isAwaiting = tab === 'AWAITING';
  // Under the awaiting chip the status control is not shown; `OPEN` is only
  // the value the status variable rests on meanwhile.
  const statusTab: StatusTab = tab === 'AWAITING' ? 'OPEN' : tab;
  const [searchTerm, setSearchTerm] = useState('');
  // 0-based page of the list on screen (filtered rows, PAGE_SIZE each).
  const [pageIndex, setPageIndex] = useState(0);
  const setTab = (next: SupportFilterTab) => {
    setPageIndex(0);
    setUrlState({ tab: next });
  };

  const {
    threads,
    hasData,
    isLoading,
    isFetching,
    isError,
    isFetchNextPageError,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useAdminSupportThreads(
    isAwaiting
      ? { awaitingReply: true }
      : { ...(statusTab !== 'ALL' && { status: statusTab }) },
    isUrlReady
  );
  // Badge in the sidebar is support_awaiting_reply from this same query.
  // The page shows that server total, never the loaded page size.
  const { counts: attentionCounts } = useAdminAttentionCounts(true);
  const awaitingTotal = attentionCounts?.support_awaiting_reply ?? null;
  // Without a resolved page there is nothing to count: a failed first load
  // must not read as an empty queue. The same holds for an EMPTY cached list
  // under a failed refetch (TQ v5 keeps it): an empty queue is only confirmed
  // by a successful read.
  const listIsKnown = hasData && !(isError && threads.length === 0);
  const listIsComplete = listIsKnown && hasNextPage !== true;
  const query = searchTerm.trim().toLowerCase();
  const isSearching = query.length > 0;

  const matchingThreads = isSearching
    ? threads.filter(thread =>
        [
          thread.subject,
          thread.user_name,
          thread.user_email,
          thread.last_message_preview ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      )
    : threads;
  // Clamped while rendering: a refetch after a reply can shorten the list
  // under the page the admin stands on.
  const lastPageIndex = Math.max(
    0,
    Math.ceil(matchingThreads.length / PAGE_SIZE) - 1
  );
  const page = Math.min(pageIndex, lastPageIndex);
  const pageThreads = matchingThreads.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  );
  const hasLoadedNext = page < lastPageIndex;

  // DECISION: "Next" enters the next page only AFTER a successful read. When the read fails the
  // rows stay on screen and the retry stands above them; moving first onto an empty page left the
  // admin with no list and no way back (the table footer disappears on error).
  const goNext = () => {
    if (hasLoadedNext) {
      setPageIndex(page + 1);
      return;
    }
    void fetchNextPage().then(result => {
      if (!result.isError) {
        setPageIndex(page + 1);
      }
    });
  };

  const error = {
    message: t('loadErrorText'),
    retryLabel: tButtons('retry'),
    onRetry: () => void (isFetchNextPageError ? fetchNextPage() : refetch()),
    isRetrying: isFetchNextPageError ? isFetchingNextPage : isFetching,
  };

  const hasNext = hasLoadedNext || (!isSearching && hasNextPage === true);
  const canSearchOlder = isSearching && hasNextPage === true && !isError;
  const footer =
    page > 0 || hasNext || canSearchOlder ? (
      <div className={styles.footer}>
        {/* While searching, „next” walks the matches already loaded; older
            threads come in through the button below. */}
        <PaginationMolecule
          mode='cursor'
          ariaLabel={t('paginationAriaLabel')}
          prevLabel={t('paginationPrev')}
          nextLabel={t('paginationNext')}
          isBusy={isFetchingNextPage}
          hasPrev={page > 0}
          hasNext={hasNext}
          onPrev={() => setPageIndex(page - 1)}
          onNext={goNext}
        />
        {/* DECISION: the search filters only the loaded pages. Without this button older
            threads were unreachable for search and "No results" lied. */}
        {canSearchOlder && (
          <ButtonAtom
            size='sm'
            variant='outlined'
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}>
            {t('searchLoadMore')}
          </ButtonAtom>
        )}
      </div>
    ) : null;

  const emptyDescription = isSearching
    ? t('emptySearchText', { query: searchTerm.trim() })
    : isAwaiting
      ? t('emptyAwaiting')
      : statusTab === 'OPEN'
        ? t('emptyOpen')
        : t('emptyFilter');

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('heroEyebrow')}
      title={t('heroTitle')}
      subtitle={t('heroSubtitle')}
      meta={
        // The count is a door to exactly the threads it counts (the same link
        // as the menu badge). Under the scope chip the chip states it once.
        !isAwaiting && awaitingTotal !== null && awaitingTotal > 0 ? (
          <AppLinkAtom href={AWAITING_SIGNAL.href} className={styles.heroDoor}>
            <HeroCountPillAtom tone='alert'>
              {t('heroPillAwaiting', { count: awaitingTotal })}
            </HeroCountPillAtom>
          </AppLinkAtom>
        ) : undefined
      }>
      <div className={styles.page}>
        {isAwaiting && (
          // List behind the badge: the server fixes the scope itself (open, last message from the user), so
          // one removable chip stands instead of the status, and the number beside it is the same counter
          // as in the menu.
          <AdminScopeChipMolecule
            label={tAttention(AWAITING_SIGNAL.scopeKey)}
            countLabel={
              awaitingTotal !== null
                ? tAttention(AWAITING_SIGNAL.countLabelKey, {
                    count: awaitingTotal,
                  })
                : null
            }
            onRemove={() => setTab(DEFAULT_SUPPORT_TAB)}
          />
        )}

        {/* DECISION: the thread count appears in the bar summary ONLY for the active status and
            says whether it is complete ("over N" while the server has more pages). The backend
            returns no per-status counters and counting them from loaded pages lies. The
            "awaiting reply" total comes from ADMIN_GET_ATTENTION_COUNTS, the same counter as
            the badge. The line is always mounted, so changing the filter does not shift the
            list. */}
        <FilterBarMolecule
          search={{
            value: searchTerm,
            onChange: value => {
              setSearchTerm(value);
              setPageIndex(0);
            },
            placeholder: t('searchPlaceholder'),
            ariaLabel: t('searchAriaLabel'),
          }}
          activeCount={!isAwaiting && tab !== DEFAULT_SUPPORT_TAB ? 1 : 0}
          onClear={() => {
            setSearchTerm('');
            setPageIndex(0);
            if (!isAwaiting) {
              setUrlState({ tab: DEFAULT_SUPPORT_TAB });
            }
          }}
          summary={
            listIsKnown && !isLoading
              ? t(listIsComplete ? 'heroPillTotal' : 'heroPillTotalMore', {
                  count: matchingThreads.length,
                })
              : ' '
          }
          labels={{ filters: t('filtersToggle'), clear: t('clearFilters') }}
          {...(!isAwaiting && {
            children: (
              <SelectAtom<StatusTab>
                density='compact'
                aria-label={t('filterAria')}
                value={statusTab}
                onValueChange={setTab}
                options={[
                  { value: 'ALL', label: t('filterAll') },
                  { value: 'OPEN', label: t('filterOpen') },
                  { value: 'RESOLVED', label: t('filterResolved') },
                  { value: 'CLOSED', label: t('filterClosed') },
                ]}
              />
            ),
          })}
        />

        <AdminSupportThreadsOrganism
          threads={pageThreads}
          state={
            isLoading || !isUrlReady
              ? 'loading'
              : isError && !listIsKnown
                ? 'error'
                : pageThreads.length > 0
                  ? 'ready'
                  : 'empty'
          }
          error={error}
          showStaleError={isError && listIsKnown && !isLoading}
          empty={{
            title: isSearching ? t('emptySearchTitle') : t('emptyTitle'),
            description: emptyDescription,
          }}
          footer={footer}
        />
      </div>
    </AdminPageLayoutComposition>
  );
}

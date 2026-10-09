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
import { AppSelectAtom } from '../../primitives/AppSelect.atom';
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
  // Filtr żyje w adresie: badge „Wsparcie N” w menu otwiera tę stronę z
  // `filter=awaiting`, a odświeżenie i „wstecz” wracają do tego samego widoku.
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

  // DECISION (nie usuwaj tego komentarza): „Następna” wchodzi na kolejną
  // stronę dopiero PO udanym odczycie. Gdy odczyt padnie, wiersze zostają na
  // ekranie, a ponowienie stoi nad nimi; przejście z góry na pustą stronę
  // zostawiało admina bez listy i bez drogi wstecz (stopka tabeli znika przy
  // błędzie).
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
        {/* DECISION (nie usuwaj tego komentarza): wyszukiwarka filtruje tylko
            wczytane strony. Bez tego przycisku starsze zgłoszenia były dla
            wyszukiwania nieosiągalne, a „Brak wyników” kłamał. */}
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
          // Lista spod badge: serwer sam ustala zakres (otwarte, ostatnia
          // wiadomość od użytkownika), więc zamiast statusu stoi jeden
          // zdejmowalny chip, a liczba obok to ten sam licznik co w menu.
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

        {/* DECISION (nie usuwaj tego komentarza): liczba wątków stoi w
            podsumowaniu paska TYLKO dla aktywnego statusu i mówi wprost, czy
            jest pełna („ponad N”, dopóki serwer ma kolejne strony). Backend
            nie zwraca liczników per status, a policzenie ich z wczytanych
            stron kłamie. Suma „czeka na odpowiedź” pochodzi z
            ADMIN_GET_ATTENTION_COUNTS, ten sam licznik co badge. Linia jest
            zawsze zamontowana, więc zmiana filtra nie przesuwa listy. */}
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
              <AppSelectAtom<StatusTab>
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

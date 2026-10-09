// UI/features/admin/AdminAuditPage.composition.tsx
// Admin audit trail: one search, the list on the shared table, the details of
// one entry in a side sheet. Server-side search (event_name contains) and
// server-side pagination. Sub-components: AdminAuditPage.parts.organism.tsx.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DownloadIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { FilterBarMolecule } from '../../components/FilterBar/FilterBar.molecule';
import { PaginationMolecule } from '../../components/Pagination/Pagination.molecule';
import {
  useAdminAuditTrail,
  type AuditTrailEntry,
} from './hooks/useAdminAuditTrail';
import {
  AuditDetailsSheetOrganism,
  AuditTableOrganism,
} from './AdminAuditPage.parts.organism';
import { exportToCSV, PAGE_SIZE } from './AdminAuditPage.helpers';
import styles from './AdminAuditPage.module.css';

export function AdminAuditPageComposition() {
  const t = useTranslations('admin.audit');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // The entry itself, not its id: the sheet keeps its content when the list
  // under it moves to another page.
  const [openEntry, setOpenEntry] = useState<AuditTrailEntry | null>(null);

  const params = {
    page,
    limit: PAGE_SIZE,
    ...(search.trim() ? { event_name: search.trim() } : {}),
  };

  const { data, isLoading, isFetching, isError, isPlaceholderData, refetch } =
    useAdminAuditTrail(params);

  // Server-side filtering (event_name contains, case-insensitive) +
  // server-side pagination — total comes straight from the API.
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleExportCSV = () => {
    if (isPlaceholderData || isError) {
      return;
    }
    exportToCSV(entries);
  };

  const readError = {
    message: t('loadError'),
    retryLabel: t('retry'),
    onRetry: () => void refetch(),
    isRetrying: isFetching,
  };
  // DECISION (nie usuwaj tego komentarza): błąd jest osobnym kanałem, nigdy
  // pustą listą. Bez żadnego odczytu (albo z pustym ostatnim odczytem, którego
  // pustki nikt nie potwierdził) tabela pokazuje błąd z ponowieniem; nieudane
  // odświeżenie zostawia ostatnie wiersze, a błąd staje nad nimi.
  const hasRows = entries.length > 0;
  const tableState = isLoading
    ? 'loading'
    : isError && !hasRows
      ? 'error'
      : hasRows
        ? 'ready'
        : 'empty';

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('pageTitle')}
      subtitle={t('subtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='outlined'
          icon={<DownloadIcon size={14} />}
          onClick={handleExportCSV}
          disabled={entries.length === 0 || isPlaceholderData || isError}>
          {t('exportCsv')}
        </ButtonAtom>
      }
      meta={
        data && !isPlaceholderData && !(isError && !hasRows) ? (
          <span className={styles.total}>
            {t('totalEntries', { count: total })}
          </span>
        ) : undefined
      }>
      {/* Stays up on error: a search that fails must stay editable, otherwise
          „Spróbuj ponownie" retried the same query forever. */}
      <FilterBarMolecule
        search={{
          value: search,
          onChange: handleSearch,
          placeholder: t('searchPlaceholder'),
          ariaLabel: t('searchAriaLabel'),
        }}
        activeCount={0}
        onClear={() => handleSearch('')}
        labels={{ filters: t('filtersToggle'), clear: t('clearSearch') }}
      />
      {isError && hasRows && <ErrorStateMolecule {...readError} />}
      <AuditTableOrganism
        entries={entries}
        state={tableState}
        error={readError}
        isSearching={search.trim().length > 0}
        onOpen={setOpenEntry}
        footer={
          <PaginationMolecule
            mode='pages'
            ariaLabel={t('paginationAriaLabel')}
            prevLabel={t('paginationPrev')}
            nextLabel={t('paginationNext')}
            page={page}
            pageCount={totalPages}
            onPageChange={setPage}
            pageLabel={n => t('paginationPage', { page: n })}
            isBusy={isPlaceholderData}
          />
        }
      />
      {openEntry !== null && (
        <AuditDetailsSheetOrganism
          entry={openEntry}
          onClose={() => setOpenEntry(null)}
        />
      )}
    </AdminPageLayoutComposition>
  );
}

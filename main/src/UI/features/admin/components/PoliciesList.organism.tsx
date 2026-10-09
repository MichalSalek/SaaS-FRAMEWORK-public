// admin/components/PoliciesList.organism.tsx
// The list of policies beside the editor (master and detail): the one shown
// in the editor is marked, the main one leads the list.

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DataTableOrganism } from '../../../components/DataTable/DataTable.organism';
import type {
  DataTableColumn,
  DataTableError,
} from '../../../components/DataTable/DataTable.organism';
import { PaginationMolecule } from '../../../components/Pagination/Pagination.molecule';
import { StatusPillAtom } from '../../../components/StatusPill/StatusPill.atom';
import { formatDateShortPL } from '../../../../application/date/date.utils';
import type { AdminPolicy } from '../hooks/useAdminPolicies';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import {
  POLICIES_PAGE_SIZE,
  orderPolicies,
  pageOfPolicy,
} from './policy-editor.utils';
import styles from '../AdminPoliciesPage.module.css';

interface PoliciesListProps {
  policies: readonly AdminPolicy[];
  state: 'ready' | 'loading' | 'empty' | 'error';
  error: DataTableError;
  selectedId: string | undefined;
  onSelect: (policy: AdminPolicy) => void;
}

export function PoliciesListOrganism({
  policies,
  state,
  error,
  selectedId,
  onSelect,
}: PoliciesListProps) {
  const t = useTranslations('admin.policies');
  const ordered = orderPolicies(policies);
  const pageCount = Math.max(1, Math.ceil(ordered.length / POLICIES_PAGE_SIZE));
  const [page, setPage] = useState(1);
  const current = Math.min(page, pageCount);

  // The policy in the editor is always on the visible page (a new policy
  // lands wherever the server orders it; a delete may empty the last page).
  const selectedPage = pageOfPolicy(ordered, selectedId);
  useEffect(() => {
    if (selectedPage !== null) {
      setPage(selectedPage);
    }
  }, [selectedPage]);

  const rows = ordered.slice(
    (current - 1) * POLICIES_PAGE_SIZE,
    current * POLICIES_PAGE_SIZE
  );

  const columns: DataTableColumn<AdminPolicy>[] = [
    {
      id: 'title',
      header: t('columnTitle'),
      priority: 'primary',
      cell: policy => policy.title,
    },
    {
      id: 'main',
      header: t('columnStatus'),
      priority: 'meta',
      cell: policy =>
        policy.is_main ? (
          <StatusPillAtom color='var(--color-success)' label={t('main')} />
        ) : null,
    },
    {
      id: 'updated',
      header: t('columnUpdated'),
      priority: 'meta',
      cell: policy => (
        <span className={styles.nowrap}>
          {t('updatedAt', { date: formatDateShortPL(policy.updated_at) })}
        </span>
      ),
    },
  ];

  return (
    <AdminPanelMolecule
      title={t('listTitle')}
      {...(state === 'ready' && { aside: String(policies.length) })}>
      <DataTableOrganism
        columns={columns}
        rows={rows}
        rowKey={policy => policy.id}
        caption={t('listTitle')}
        onRowClick={onSelect}
        rowLabel={policy => t('selectRowAriaLabel', { title: policy.title })}
        selectedKey={selectedId ?? null}
        state={state}
        empty={<p className={styles.listEmpty}>{t('listEmpty')}</p>}
        error={error}
        skeletonRows={6}
        density='compact'
        surface='flush'
        footer={
          pageCount > 1 ? (
            <PaginationMolecule
              mode='pages'
              ariaLabel={t('paginationAriaLabel')}
              prevLabel={t('paginationPrev')}
              nextLabel={t('paginationNext')}
              summary={t('paginationSummary', { page: current, pageCount })}
              page={current}
              pageCount={pageCount}
              onPageChange={setPage}
              pageLabel={n => t('paginationPage', { page: n })}
            />
          ) : undefined
        }
      />
    </AdminPanelMolecule>
  );
}

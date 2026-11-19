// UI/features/admin/AdminAiCrawlersPage/components/AdminAiCrawlersByPath.organism.tsx
// Ten most visited paths of the statistics window. A row opens the event list
// narrowed to that path.

import { useTranslations } from 'next-intl';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../../../components/DataTable/DataTable.organism';
import { AdminPanelMolecule } from '../../components/AdminPanel.molecule';
import type { AiCrawlerStatsResponse } from '../../hooks/useAiCrawlerStats';
import { SoftBreakTextAtom } from '../../../../components/SoftBreakText/SoftBreakText.atom';
import styles from '../AdminAiCrawlersPage.module.css';

type PathRow = AiCrawlerStatsResponse['crawls_by_path'][number];

interface AdminAiCrawlersByPathProps {
  data: AiCrawlerStatsResponse['crawls_by_path'];
  isLoading: boolean;
  onOpen: (path: string) => void;
}

export function AdminAiCrawlersByPathOrganism({
  data,
  isLoading,
  onOpen,
}: AdminAiCrawlersByPathProps) {
  const t = useTranslations('admin.aiCrawlers');

  const max = Math.max(...data.map(d => d.count), 1);
  const rows = data.slice(0, 10);

  const columns: DataTableColumn<PathRow>[] = [
    {
      id: 'path',
      header: t('list.column.path'),
      priority: 'primary',
      cell: row => (
        <>
          <SoftBreakTextAtom className={styles.mono}>
            {row.path}
          </SoftBreakTextAtom>
          <span className={styles.shareTrack} aria-hidden='true'>
            <span
              className={styles.shareFill}
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </span>
        </>
      ),
    },
    {
      id: 'count',
      header: t('panel.count'),
      priority: 'meta',
      align: 'end',
      width: '6rem',
      labelInCard: true,
      cell: row => row.count.toLocaleString('pl-PL'),
    },
  ];

  return (
    <AdminPanelMolecule title={t('byPath.title')}>
      <DataTableOrganism
        caption={t('byPath.title')}
        columns={columns}
        rows={rows}
        rowKey={row => row.path}
        rowLabel={row => t('panel.openInList', { name: row.path })}
        onRowClick={row => onOpen(row.path)}
        state={isLoading ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
        empty={t('byPath.empty')}
        density='compact'
        surface='flush'
        skeletonRows={5}
      />
    </AdminPanelMolecule>
  );
}

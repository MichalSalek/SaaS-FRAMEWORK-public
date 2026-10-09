// UI/features/admin/AdminAiCrawlersPage/components/AdminAiCrawlersByCategory.organism.tsx
// Share of every bot category in the statistics window. A row opens the event
// list narrowed to that category.

import type { CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../../../components/DataTable/DataTable.organism';
import { AdminPanelMolecule } from '../../components/AdminPanel.molecule';
import type { AiCrawlerStatsResponse } from '../../hooks/useAiCrawlerStats';
import {
  crawlerCategoryColor,
  crawlerCategoryLabelKey,
} from '../crawler-category-label';
import { formatFixed1 } from '../../reports-format';
import styles from '../AdminAiCrawlersPage.module.css';

type CategoryRow = AiCrawlerStatsResponse['crawls_by_category'][number];

interface AdminAiCrawlersByCategoryProps {
  data: AiCrawlerStatsResponse['crawls_by_category'];
  isLoading: boolean;
  onOpen: (category: string) => void;
}

export function AdminAiCrawlersByCategoryOrganism({
  data,
  isLoading,
  onOpen,
}: AdminAiCrawlersByCategoryProps) {
  const t = useTranslations('admin.aiCrawlers');
  const locale = useLocale();

  const total = data.reduce((acc, c) => acc + c.count, 0);
  const share = (count: number) => (total > 0 ? (count / total) * 100 : 0);
  const label = (category: string) => {
    const key = crawlerCategoryLabelKey(category);
    return key ? t(key) : category;
  };

  const columns: DataTableColumn<CategoryRow>[] = [
    {
      id: 'category',
      header: t('list.column.category'),
      priority: 'primary',
      cell: row => (
        <>
          {label(row.bot_category)}
          <span className={styles.shareTrack} aria-hidden='true'>
            <span
              className={styles.shareFill}
              style={
                {
                  width: `${share(row.count)}%`,
                  '--share-color': crawlerCategoryColor(row.bot_category),
                } as CSSProperties
              }
            />
          </span>
        </>
      ),
    },
    {
      id: 'share',
      header: t('panel.share'),
      priority: 'meta',
      align: 'end',
      width: '5rem',
      cell: row => `${formatFixed1(share(row.count), locale)}%`,
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
    <AdminPanelMolecule title={t('byCategory.title')}>
      <DataTableOrganism
        caption={t('byCategory.title')}
        columns={columns}
        rows={data}
        rowKey={row => row.bot_category}
        rowLabel={row =>
          t('panel.openInList', { name: label(row.bot_category) })
        }
        onRowClick={row => onOpen(row.bot_category)}
        state={isLoading ? 'loading' : data.length === 0 ? 'empty' : 'ready'}
        empty={t('byCategory.empty')}
        density='compact'
        surface='flush'
        skeletonRows={5}
      />
    </AdminPanelMolecule>
  );
}

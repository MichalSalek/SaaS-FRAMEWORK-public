// UI/features/admin/AdminAiCrawlersPage/components/AdminAiCrawlersTopBots.organism.tsx
// Ten most active bots of the statistics window. A row opens the event list
// narrowed to that bot: the count leads to the events it counts.

import { useTranslations } from 'next-intl';
import {
  DataTableOrganism,
  type DataTableColumn,
} from '../../../../components/DataTable/DataTable.organism';
import { AdminPanelMolecule } from '../../components/AdminPanel.molecule';
import type { AiCrawlerStatsResponse } from '../../hooks/useAiCrawlerStats';
import { CrawlerCategoryPillMolecule } from './CrawlerCategoryPill.molecule';
import styles from '../AdminAiCrawlersPage.module.css';

type BotRow = AiCrawlerStatsResponse['crawls_by_bot'][number];

interface AdminAiCrawlersTopBotsProps {
  data: AiCrawlerStatsResponse['crawls_by_bot'];
  isLoading: boolean;
  onOpen: (botName: string) => void;
}

export function AdminAiCrawlersTopBotsOrganism({
  data,
  isLoading,
  onOpen,
}: AdminAiCrawlersTopBotsProps) {
  const t = useTranslations('admin.aiCrawlers');

  const max = Math.max(...data.map(d => d.count), 1);
  const rows = data.slice(0, 10);

  const columns: DataTableColumn<BotRow>[] = [
    {
      id: 'bot',
      header: t('list.column.botName'),
      priority: 'primary',
      cell: bot => (
        <>
          {bot.bot_name}
          <span className={styles.shareTrack} aria-hidden='true'>
            <span
              className={styles.shareFill}
              style={{ width: `${(bot.count / max) * 100}%` }}
            />
          </span>
        </>
      ),
    },
    {
      id: 'category',
      header: t('list.column.category'),
      priority: 'meta',
      width: '10.5rem',
      cell: bot => <CrawlerCategoryPillMolecule category={bot.bot_category} />,
    },
    {
      id: 'count',
      header: t('panel.count'),
      priority: 'meta',
      align: 'end',
      width: '6rem',
      labelInCard: true,
      cell: bot => bot.count.toLocaleString('pl-PL'),
    },
  ];

  return (
    <AdminPanelMolecule title={t('topBots.title')}>
      <DataTableOrganism
        caption={t('topBots.title')}
        columns={columns}
        rows={rows}
        rowKey={bot => bot.bot_name}
        rowLabel={bot => t('panel.openInList', { name: bot.bot_name })}
        onRowClick={bot => onOpen(bot.bot_name)}
        state={isLoading ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
        empty={t('topBots.empty')}
        density='compact'
        surface='flush'
        skeletonRows={5}
      />
    </AdminPanelMolecule>
  );
}

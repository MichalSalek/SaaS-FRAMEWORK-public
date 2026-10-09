// UI/features/admin/AdminAiCrawlersPage/components/AdminAiCrawlersDashboard.organism.tsx
// The four figures of the statistics window in one band. A figure that counts
// events is a door: it narrows the event list below to exactly what it counts
// (pressed again, it lets the list go). „Różne boty” counts bots, not events:
// its items are the „Top boty” panel, so it stays read-only.

import { useTranslations } from 'next-intl';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../../../components/StatTile/StatTile.molecule';
import type { AiCrawlerStatsResponse } from '../../hooks/useAiCrawlerStats';
import { crawlerCategoryLabelKey } from '../crawler-category-label';

/** Which statistic the event list is currently narrowed to. */
export type CrawlerDoor = 'all' | 'topBot' | 'topPath' | null;

interface AdminAiCrawlersDashboardProps {
  stats: AiCrawlerStatsResponse | null;
  isLoading: boolean;
  openDoor: CrawlerDoor;
  onToggleAll: () => void;
  onToggleBot: (botName: string) => void;
  onTogglePath: (path: string) => void;
}

export function AdminAiCrawlersDashboardOrganism({
  stats,
  isLoading,
  openDoor,
  onToggleAll,
  onToggleBot,
  onTogglePath,
}: AdminAiCrawlersDashboardProps) {
  const t = useTranslations('admin.aiCrawlers');

  const topBot = stats?.crawls_by_bot[0] ?? null;
  const topBotCategoryKey = topBot
    ? crawlerCategoryLabelKey(topBot.bot_category)
    : null;
  const topPath = stats?.crawls_by_path[0] ?? null;
  const pending = isLoading || stats === null;

  return (
    <StatTileBandMolecule ariaLabel={t('dashboard.ariaLabel')}>
      <StatTileMolecule
        label={t('dashboard.totalCrawls')}
        value={stats?.total_crawls.toLocaleString('pl-PL')}
        loading={pending}
        selected={openDoor === 'all'}
        onSelect={onToggleAll}
      />
      <StatTileMolecule
        label={t('dashboard.uniqueBots')}
        value={stats?.unique_bots.toLocaleString('pl-PL')}
        loading={pending}
      />
      {/* No bot yet inside a non-empty window cannot happen; while loading the
          tile is read-only, so nothing can be pressed before it has a target. */}
      <StatTileMolecule
        label={t('dashboard.topBot')}
        value={topBot?.bot_name}
        loading={pending}
        selected={openDoor === 'topBot'}
        {...(topBot !== null && {
          hint: `${topBot.count.toLocaleString('pl-PL')} (${
            topBotCategoryKey ? t(topBotCategoryKey) : topBot.bot_category
          })`,
          onSelect: () => onToggleBot(topBot.bot_name),
        })}
      />
      <StatTileMolecule
        label={t('dashboard.topPath')}
        value={topPath?.path}
        loading={pending}
        selected={openDoor === 'topPath'}
        {...(topPath !== null && {
          hint: topPath.count.toLocaleString('pl-PL'),
          onSelect: () => onTogglePath(topPath.path),
        })}
      />
    </StatTileBandMolecule>
  );
}

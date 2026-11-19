// UI/features/admin/AdminAiCrawlersPage/components/AdminAiCrawlersDailyChart.organism.tsx
// Bar chart — crawls per day over the statistics window. CSS-only.
//
// The bars are NOT doors to the list: the list's `to_date` is compared as an
// instant (the start of that day), so „from day X to day X” returns nothing.
// A bar tells its day and count through its title; the list below is filtered
// with its own date range.

import { useTranslations } from 'next-intl';
import { SkeletonAtom } from '../../../../components/Skeleton/Skeleton.atom';
import { AdminPanelMolecule } from '../../components/AdminPanel.molecule';
import type { AiCrawlerStatsResponse } from '../../hooks/useAiCrawlerStats';
import styles from '../AdminAiCrawlersPage.module.css';

interface AdminAiCrawlersDailyChartProps {
  data: AiCrawlerStatsResponse['crawls_by_day'];
  isLoading: boolean;
}

export function AdminAiCrawlersDailyChartOrganism({
  data,
  isLoading,
}: AdminAiCrawlersDailyChartProps) {
  const t = useTranslations('admin.aiCrawlers');

  const max = Math.max(...data.map(d => d.count), 1);
  const total = data.reduce((acc, d) => acc + d.count, 0);

  return (
    <AdminPanelMolecule
      title={t('chart.title')}
      {...(!isLoading &&
        data.length > 0 && {
          aside: t('chart.total', { count: total.toLocaleString('pl-PL') }),
        })}>
      <div className={styles.chartBox}>
        {isLoading ? (
          <div className={styles.chartSkeleton}>
            {Array.from({ length: 30 }, (_, i) => (
              <SkeletonAtom
                key={i}
                variant='rect'
                height={`${20 + ((i * 11) % 60)}%`}
                width='100%'
              />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className={styles.chartEmpty}>{t('chart.empty')}</p>
        ) : (
          <div
            className={styles.dailyBars}
            role='img'
            aria-label={t('chart.ariaLabel', { days: data.length })}>
            {data.map(d => (
              <div
                key={d.date}
                className={styles.dailyBarWrap}
                title={t('chart.barTooltip', {
                  date: d.date,
                  count: d.count,
                  bot: d.top_bot ?? t('chart.noTopBot'),
                })}>
                <div className={styles.dailyBarTrack}>
                  <div
                    className={styles.dailyBarFill}
                    style={{
                      height: `${Math.max((d.count / max) * 100, 2)}%`,
                    }}
                  />
                </div>
                <span className={styles.dailyBarLabel}>{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminPanelMolecule>
  );
}

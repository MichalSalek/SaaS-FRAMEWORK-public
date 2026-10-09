// UI/features/admin/AdminAiCrawlersPage/components/AdminAiCrawlersList.organism.tsx
// Raw crawl events: the shared filter bar (category, bot, path, date range),
// the shared table and the shared pager. Filters live in the URL (the page's
// `useAiCrawlerUrlState`); this organism only shows and asks.

import { useTranslations } from 'next-intl';
import { RobotIcon } from '@phosphor-icons/react';
import { AI_CRAWLER_MAX_PAGE_SIZE } from '@kernel/domain/admin/ai-crawler.types';
import { formatTimestampPL } from '../../../../../application/date/date.utils';
import {
  DataTableOrganism,
  type DataTableColumn,
  type DataTableError,
} from '../../../../components/DataTable/DataTable.organism';
import { EmptyStateAtom } from '../../../../components/EmptyState/EmptyState.atom';
import { FilterBarMolecule } from '../../../../components/FilterBar/FilterBar.molecule';
import { PaginationMolecule } from '../../../../components/Pagination/Pagination.molecule';
import { SelectAtom } from '../../../../components/Select/Select.atom';
import { InputAtom } from '../../../../components/Input/Input.atom';
import type {
  AiCrawlerListRequest,
  AiCrawlerListResponse,
} from '../../hooks/useAiCrawlerList';
import { crawlerCategoryLabelKey } from '../crawler-category-label';
import {
  countCrawlerFilters,
  type CrawlerFilterKey,
} from '../crawler-stats-window';
import { CrawlerCategoryPillMolecule } from './CrawlerCategoryPill.molecule';
import { SoftBreakTextAtom } from '../../../../components/SoftBreakText/SoftBreakText.atom';
import styles from '../AdminAiCrawlersPage.module.css';

type CrawlEvent = AiCrawlerListResponse['items'][number];

interface AdminAiCrawlersListProps {
  response: AiCrawlerListResponse | null;
  params: AiCrawlerListRequest;
  isLoading: boolean;
  /** A page or a filter change is on its way: the pager waits. */
  isFetching: boolean;
  isError: boolean;
  error: DataTableError;
  categoryOptions: ReadonlyArray<string>;
  botNameOptions: ReadonlyArray<string>;
  pathOptions: ReadonlyArray<string>;
  onFilter: (key: CrawlerFilterKey, value: string | null) => void;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  onReset: () => void;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, AI_CRAWLER_MAX_PAGE_SIZE] as const;

export function AdminAiCrawlersListOrganism({
  response,
  params,
  isLoading,
  isFetching,
  isError,
  error,
  categoryOptions,
  botNameOptions,
  pathOptions,
  onFilter,
  onPage,
  onPageSize,
  onReset,
}: AdminAiCrawlersListProps) {
  const t = useTranslations('admin.aiCrawlers');

  const total = response?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.page_size));
  const items = response?.items ?? [];
  const activeCount = countCrawlerFilters(params);
  const all = { value: '', label: t('list.filter.all') };

  const columns: DataTableColumn<CrawlEvent>[] = [
    {
      id: 'bot',
      header: t('list.column.botName'),
      priority: 'primary',
      width: '10rem',
      cell: item => item.bot_name,
    },
    {
      id: 'path',
      header: t('list.column.path'),
      priority: 'secondary',
      cell: item => (
        <SoftBreakTextAtom className={styles.mono}>
          {item.path}
        </SoftBreakTextAtom>
      ),
    },
    {
      id: 'userAgent',
      header: t('list.column.userAgent'),
      priority: 'secondary',
      width: 'minmax(0, 2fr)',
      cell: item => <span className={styles.quiet}>{item.user_agent}</span>,
    },
    {
      id: 'category',
      header: t('list.column.category'),
      priority: 'meta',
      width: '10.5rem',
      cell: item => (
        <CrawlerCategoryPillMolecule category={item.bot_category} />
      ),
    },
    {
      id: 'country',
      header: t('list.column.country'),
      priority: 'meta',
      width: '5.5rem',
      labelInCard: true,
      cell: item => item.country ?? t('list.countryUnknown'),
    },
    {
      id: 'time',
      header: t('list.column.time'),
      priority: 'meta',
      width: '9.5rem',
      cell: item => (
        <span className={styles.nowrap}>
          {formatTimestampPL(item.created_at)}
        </span>
      ),
    },
  ];

  return (
    <>
      <FilterBarMolecule
        surface='flush'
        activeCount={activeCount}
        onClear={onReset}
        labels={{
          filters: t('list.filter.toggle'),
          clear: t('list.filter.reset'),
        }}>
        <SelectAtom
          className={styles.filterControl}
          label={t('list.filter.category')}
          value={params.bot_category ?? ''}
          onChange={e => onFilter('bot_category', e.target.value || null)}
          options={[
            all,
            ...categoryOptions.map(value => {
              const key = crawlerCategoryLabelKey(value);
              return { value, label: key ? t(key) : value };
            }),
          ]}
        />
        <SelectAtom
          className={styles.filterControl}
          label={t('list.filter.bot')}
          value={params.bot_name ?? ''}
          onChange={e => onFilter('bot_name', e.target.value || null)}
          options={[all, ...botNameOptions.map(v => ({ value: v, label: v }))]}
        />
        <SelectAtom
          className={styles.filterControl}
          label={t('list.filter.path')}
          value={params.path ?? ''}
          onChange={e => onFilter('path', e.target.value || null)}
          options={[all, ...pathOptions.map(v => ({ value: v, label: v }))]}
        />
        <InputAtom
          type='date'
          className={styles.filterControl}
          label={t('list.filter.from')}
          value={params.from_date ?? ''}
          {...(params.to_date ? { max: params.to_date } : {})}
          onChange={e => onFilter('from_date', e.target.value || null)}
        />
        <InputAtom
          type='date'
          className={styles.filterControl}
          label={t('list.filter.to')}
          value={params.to_date ?? ''}
          {...(params.from_date ? { min: params.from_date } : {})}
          onChange={e => onFilter('to_date', e.target.value || null)}
        />
      </FilterBarMolecule>

      <DataTableOrganism
        caption={t('list.title')}
        columns={columns}
        rows={items}
        rowKey={item => item.id}
        // Under an error an empty table is unconfirmed, cached or not: never
        // claim „no events".
        state={
          isLoading
            ? 'loading'
            : items.length > 0
              ? 'ready'
              : isError
                ? 'error'
                : 'empty'
        }
        error={error}
        surface='flush'
        skeletonRows={8}
        empty={
          activeCount > 0 ? (
            <EmptyStateAtom
              icon={<RobotIcon size={28} />}
              titleAs='h3'
              title={t('list.emptyFiltered')}
              description={t('list.emptyFilteredHint')}
            />
          ) : (
            <EmptyStateAtom
              icon={<RobotIcon size={28} />}
              titleAs='h3'
              title={t('empty.title')}
              description={t('empty.description')}
            />
          )
        }
        {...(total > 0 && {
          // No events, no pager and no page size to choose.
          footer: (
            <div className={styles.listFooter}>
              <SelectAtom
                className={styles.pageSize}
                aria-label={t('list.pageSize')}
                value={String(params.page_size)}
                onChange={e => onPageSize(Number(e.target.value))}
                options={PAGE_SIZE_OPTIONS.map(size => ({
                  value: String(size),
                  label: t('list.pageSizeOption', { count: size }),
                }))}
              />
              <PaginationMolecule
                mode='pages'
                ariaLabel={t('list.pagination.ariaLabel')}
                prevLabel={t('list.pagination.prev')}
                nextLabel={t('list.pagination.next')}
                page={params.page}
                pageCount={totalPages}
                onPageChange={onPage}
                pageLabel={n => t('list.pagination.page', { page: n })}
                isBusy={isFetching}
              />
            </div>
          ),
        })}
      />
    </>
  );
}

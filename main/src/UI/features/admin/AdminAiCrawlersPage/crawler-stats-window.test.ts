import { describe, expect, it } from 'vitest';
import {
  countCrawlerFilters,
  crawlerDoorParams,
  isCrawlerDoorOpen,
  statsWindowStart,
} from './crawler-stats-window';

const NOW = new Date('2026-10-09T12:00:00.000Z');

describe('statsWindowStart', () => {
  it('returns the day thirty days before now', () => {
    expect(statsWindowStart(NOW)).toBe('2026-09-09');
  });
});

describe('countCrawlerFilters', () => {
  it('ignores page, page size and empty filters', () => {
    expect(
      countCrawlerFilters({ page: 3, page_size: 100, bot_name: null, path: '' })
    ).toBe(0);
  });

  it('counts every set filter', () => {
    expect(
      countCrawlerFilters({
        page: 1,
        page_size: 50,
        bot_name: 'GPTBot',
        from_date: '2026-09-09',
      })
    ).toBe(2);
  });
});

describe('crawler doors', () => {
  it('narrows the list to the statistics window and one dimension', () => {
    expect(
      crawlerDoorParams(
        { page: 4, page_size: 100, path: '/blog/', to_date: '2026-10-01' },
        NOW,
        { bot_name: 'GPTBot' }
      )
    ).toEqual({
      page: 1,
      page_size: 100,
      from_date: '2026-09-09',
      bot_name: 'GPTBot',
    });
  });

  it('is open only when the list shows exactly that door', () => {
    const door = crawlerDoorParams({ page: 1, page_size: 50 }, NOW, {
      bot_name: 'GPTBot',
    });
    expect(isCrawlerDoorOpen(door, NOW, { bot_name: 'GPTBot' })).toBe(true);
    expect(
      isCrawlerDoorOpen({ ...door, page: 2 }, NOW, { bot_name: 'GPTBot' })
    ).toBe(true);
    expect(
      isCrawlerDoorOpen({ ...door, path: '/blog/' }, NOW, {
        bot_name: 'GPTBot',
      })
    ).toBe(false);
    expect(isCrawlerDoorOpen(door, NOW, {})).toBe(false);
  });
});

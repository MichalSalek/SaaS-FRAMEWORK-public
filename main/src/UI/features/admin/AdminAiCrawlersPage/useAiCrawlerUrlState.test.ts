import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiCrawlerUrlState } from './useAiCrawlerUrlState';

type Query = Record<string, string | string[] | undefined>;

const router: {
  isReady: boolean;
  pathname: string;
  query: Query;
  replace: ReturnType<typeof vi.fn>;
} = {
  isReady: true,
  pathname: '/app/admin/ai-crawlers',
  query: {},
  replace: vi.fn(() => Promise.resolve(true)),
};

vi.mock('next/router', () => ({ useRouter: () => router }));

describe('useAiCrawlerUrlState', () => {
  beforeEach(() => {
    router.isReady = true;
    router.query = {};
    router.replace.mockClear();
  });

  it('hydrates a ready deep link without writing defaults over its filters', () => {
    router.query = {
      page: '3',
      bot_name: 'GPTBot',
      path: '/pricing',
      source: 'owner',
    };
    const { result } = renderHook(() => useAiCrawlerUrlState());

    expect(result.current[2]).toBe(true);
    expect(result.current[0]).toMatchObject({
      page: 3,
      bot_name: 'GPTBot',
      path: '/pricing',
    });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('keeps newer local filters when an older asynchronous own write lands', () => {
    router.query = { source: 'owner' };
    const { result, rerender } = renderHook(() => useAiCrawlerUrlState());

    act(() =>
      result.current[1](previous => ({ ...previous, bot_name: 'GPT' }))
    );
    act(() =>
      result.current[1](previous => ({ ...previous, bot_name: 'GPTBot' }))
    );
    expect(router.replace).toHaveBeenCalledTimes(2);

    router.query = { source: 'owner', bot_name: 'GPT' };
    rerender();
    expect(result.current[0].bot_name).toBe('GPTBot');

    router.query = { source: 'owner', bot_name: 'GPTBot' };
    rerender();
    expect(result.current[0].bot_name).toBe('GPTBot');
    expect(router.replace).toHaveBeenCalledTimes(2);
    expect(router.replace.mock.calls[1]?.[0]).toMatchObject({
      query: { source: 'owner', bot_name: 'GPTBot' },
    });
  });

  it('follows external navigation and preserves its unrelated parameters on the next edit', () => {
    const { result, rerender } = renderHook(() => useAiCrawlerUrlState());
    router.query = { page: '2', bot_category: 'search', source: 'bookmark' };
    rerender();
    expect(result.current[0]).toMatchObject({
      page: 2,
      bot_category: 'search',
    });

    act(() =>
      result.current[1](previous => ({
        ...previous,
        page: 1,
        path: '/contact',
      }))
    );
    expect(router.replace.mock.calls.at(-1)?.[0]).toMatchObject({
      query: { bot_category: 'search', path: '/contact', source: 'bookmark' },
    });
  });

  it('waits for router readiness before hydrating a delayed deep link', () => {
    router.isReady = false;
    const { result, rerender } = renderHook(() => useAiCrawlerUrlState());
    expect(result.current[2]).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();

    router.isReady = true;
    router.query = { page: '4', bot_name: 'ClaudeBot' };
    rerender();
    expect(result.current[0]).toMatchObject({ page: 4, bot_name: 'ClaudeBot' });
    expect(router.replace).not.toHaveBeenCalled();
  });
});

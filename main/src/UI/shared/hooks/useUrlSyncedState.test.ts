// URL mirror of view state: our own asynchronous `router.replace` writes must
// never be parsed back over newer local state.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlSyncedState, type UrlStateCodec } from './useUrlSyncedState';

type Query = Record<string, string | string[] | undefined>;

const router: {
  isReady: boolean;
  pathname: string;
  query: Query;
  replace: ReturnType<typeof vi.fn>;
} = {
  isReady: true,
  pathname: '/app/admin/users',
  query: {},
  replace: vi.fn(() => Promise.resolve(true)),
};

vi.mock('next/router', () => ({
  useRouter: () => router,
}));

const codec: UrlStateCodec<{ q: string }> = {
  keys: ['q'],
  parse: query => ({ q: typeof query['q'] === 'string' ? query['q'] : '' }),
  build: state => (state.q ? { q: state.q } : {}),
};

describe('useUrlSyncedState', () => {
  beforeEach(() => {
    router.query = {};
    router.replace.mockClear();
  });

  it('does not rewind to an older write that lands after a newer keystroke', () => {
    const { result, rerender } = renderHook(() => useUrlSyncedState(codec));
    expect(result.current[2]).toBe(true);

    act(() => result.current[1]({ q: 'a' }));
    act(() => result.current[1]({ q: 'ab' }));
    expect(router.replace).toHaveBeenCalledTimes(2);

    // The first replace lands only now, after "ab" was already written.
    router.query = { q: 'a' };
    rerender();
    expect(result.current[0].q).toBe('ab');

    router.query = { q: 'ab' };
    rerender();
    expect(result.current[0].q).toBe('ab');
  });

  it('still follows an external URL change (back/forward, a link)', () => {
    const { result, rerender } = renderHook(() => useUrlSyncedState(codec));
    act(() => result.current[1]({ q: 'a' }));
    router.query = { q: 'a' };
    rerender();

    router.query = { q: 'zzz' };
    rerender();
    expect(result.current[0].q).toBe('zzz');
  });

  it('keeps query parameters it does not own', () => {
    // A playground variant and a promo code sit in the address before the page
    // syncs its own filter; neither may be dropped by the first write.
    router.query = { pg: 'demo-vote:a', promo: 'XYZ' };
    const { result } = renderHook(() => useUrlSyncedState(codec));
    expect(router.replace).not.toHaveBeenCalled();

    act(() => result.current[1]({ q: 'ola' }));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace.mock.calls[0]?.[0]).toEqual({
      pathname: '/app/admin/users',
      query: { pg: 'demo-vote:a', promo: 'XYZ', q: 'ola' },
    });
  });

  it('does not treat a foreign parameter change as its own state change', () => {
    router.query = { q: 'ola' };
    const { result, rerender } = renderHook(() => useUrlSyncedState(codec));
    router.query = { q: 'ola', pg: 'demo-vote:b' };
    rerender();
    expect(result.current[0].q).toBe('ola');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reads the initial state from the URL', () => {
    router.query = { q: 'deep-link' };
    const { result } = renderHook(() => useUrlSyncedState(codec));
    expect(result.current[0].q).toBe('deep-link');
    expect(router.replace).not.toHaveBeenCalled();
  });
});

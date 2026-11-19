// usePinnedOrder — the move helper, optimistic order, rollback and request order.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { movePinnedRecord, usePinnedOrder } from './usePinnedOrder';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';

interface Deferred {
  ids: string[];
  resolve: () => void;
  reject: () => void;
}

const sent: Deferred[] = [];
const reorderIO = vi.fn(
  (req: { gallery_record_ids: string[] }) =>
    new Promise((resolve, reject) => {
      sent.push({
        ids: req.gallery_record_ids,
        resolve: () =>
          resolve({
            success: true,
            gallery_record_ids: req.gallery_record_ids,
          }),
        reject: () => reject(new Error('stale')),
      });
    })
);
const getIO = vi.fn();

vi.mock('../../../../../domain/gallery/galleryIO.possibilities.api', () => ({
  galleryReorderPinnedRecords_IO: (req: { gallery_record_ids: string[] }) =>
    reorderIO(req),
  galleryGetPinnedRecords_IO: () => getIO(),
}));

const record = (id: string) => ({
  gallery_record_id: id,
  asset_url: `u-${id}`,
});
const SERVER = [record('a'), record('b'), record('c')];

const ids = (client: QueryClient) =>
  (
    client.getQueryData(queryKeys.gallery.pinned) as {
      records: Array<{ gallery_record_id: string }>;
    }
  ).records.map(r => r.gallery_record_id);

const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => usePinnedOrder(), { wrapper });
  return { client, ...hook };
};

describe('movePinnedRecord', () => {
  it('swaps with the neighbour in the given direction', () => {
    expect(movePinnedRecord(['a', 'b', 'c'], 1, 'up')).toEqual(['b', 'a', 'c']);
    expect(movePinnedRecord(['a', 'b', 'c'], 1, 'down')).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('returns the SAME array at the edges (nothing to send)', () => {
    const items = ['a', 'b'];
    expect(movePinnedRecord(items, 0, 'up')).toBe(items);
    expect(movePinnedRecord(items, 1, 'down')).toBe(items);
    expect(movePinnedRecord(items, 5, 'up')).toBe(items);
  });
});

describe('usePinnedOrder', () => {
  beforeEach(() => {
    sent.length = 0;
    reorderIO.mockClear();
    getIO.mockReset();
    getIO.mockResolvedValue({ records: SERVER });
  });

  it('moves optimistically and sends the FULL new order', async () => {
    const { client, result } = setup();
    await waitFor(() => expect(result.current.records).toHaveLength(3));

    act(() => {
      expect(result.current.move(2, 'up')).toBe(true);
    });

    await waitFor(() => expect(ids(client)).toEqual(['a', 'c', 'b']));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.ids).toEqual(['a', 'c', 'b']);
  });

  it('a move off the edge sends nothing', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.records).toHaveLength(3));

    act(() => {
      expect(result.current.move(0, 'up')).toBe(false);
    });
    expect(reorderIO).not.toHaveBeenCalled();
  });

  it('a failed move rolls the list back', async () => {
    const { client, result } = setup();
    await waitFor(() => expect(result.current.records).toHaveLength(3));
    getIO.mockImplementation(() => new Promise(() => {})); // refetch never lands

    act(() => {
      result.current.move(0, 'down');
    });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(ids(client)).toEqual(['b', 'a', 'c']);

    await act(async () => {
      sent[0]?.reject();
    });
    await waitFor(() => expect(ids(client)).toEqual(['a', 'b', 'c']));
  });

  it('two quick moves go out one after another, the second with both moves', async () => {
    const { client, result } = setup();
    await waitFor(() => expect(result.current.records).toHaveLength(3));

    act(() => {
      result.current.move(0, 'down'); // b a c
    });
    await waitFor(() => expect(ids(client)).toEqual(['b', 'a', 'c']));
    act(() => {
      result.current.move(1, 'down'); // b c a
    });
    await waitFor(() => expect(ids(client)).toEqual(['b', 'c', 'a']));

    // Scoped: the second request waits until the first one settles.
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.ids).toEqual(['b', 'a', 'c']);

    await act(async () => {
      sent[0]?.resolve();
    });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]?.ids).toEqual(['b', 'c', 'a']);
  });
});

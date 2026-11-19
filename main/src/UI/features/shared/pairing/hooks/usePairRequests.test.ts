import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import {
  createQueryWrapper,
  makeTestQueryClient,
} from '../../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../../test-utils/msw/server';
import { useMyPendingRequests } from './usePairRequests';

const PENDING_URL = '*/api/v1/pairing/my-pending-requests';
const request = {
  pair_id: 'pair-1',
  stylist_account_id: 'stylist-1',
  display_name: 'Anna',
  avatar_url: null,
  requested_at: '2026-10-24T10:00:00.000Z',
};

describe('useMyPendingRequests reconciliation', () => {
  it('invalidates pairs and the removed stylist access only after a successful membership removal', async () => {
    let requests = [request];
    mswServer.use(
      http.get(PENDING_URL, () =>
        HttpResponse.json({ event: 'APPLICATION_SUCCESS', data: { requests } })
      )
    );
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.pairing.pairs, { pages: [], pageParams: [] });
    client.setQueryData(queryKeys.pairing.accessStatus('stylist-1'), {
      access: 'PENDING',
      pair_id: 'pair-1',
    });
    client.setQueryData(queryKeys.pairing.accessStatus('other-stylist'), {
      access: 'PUBLIC',
      pair_id: null,
    });
    const { result } = renderHook(() => useMyPendingRequests(true), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => expect(result.current.data?.requests).toHaveLength(1));
    expect(client.getQueryState(queryKeys.pairing.pairs)?.isInvalidated).toBe(
      false
    );

    requests = [];
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() =>
      expect(client.getQueryState(queryKeys.pairing.pairs)?.isInvalidated).toBe(
        true
      )
    );
    expect(
      client.getQueryState(queryKeys.pairing.accessStatus('stylist-1'))
        ?.isInvalidated
    ).toBe(true);
    expect(
      client.getQueryState(queryKeys.pairing.accessStatus('other-stylist'))
        ?.isInvalidated
    ).toBe(false);

    client.setQueryData(queryKeys.pairing.pairs, { pages: [], pageParams: [] });
    await act(async () => {
      await result.current.refetch();
    });
    expect(client.getQueryState(queryKeys.pairing.pairs)?.isInvalidated).toBe(
      false
    );
  });

  it('does not invalidate pairs on initial reads, unchanged polls or added requests', async () => {
    let requests = [request];
    mswServer.use(
      http.get(PENDING_URL, () =>
        HttpResponse.json({ event: 'APPLICATION_SUCCESS', data: { requests } })
      )
    );
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.pairing.pairs, { pages: [], pageParams: [] });
    const { result } = renderHook(() => useMyPendingRequests(true), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => expect(result.current.data?.requests).toHaveLength(1));

    await act(async () => {
      await result.current.refetch();
    });
    requests = [
      { ...request, display_name: 'Anna Nowak' },
      { ...request, pair_id: 'pair-2', stylist_account_id: 'stylist-2' },
    ];
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.data?.requests).toHaveLength(2));
    expect(client.getQueryState(queryKeys.pairing.pairs)?.isInvalidated).toBe(
      false
    );
  });

  it('keeps cached requests on failure and reconciles their disappearance on recovery', async () => {
    let failed = false;
    let requests = [request];
    mswServer.use(
      http.get(PENDING_URL, () =>
        failed
          ? HttpResponse.json(
              { event: 'GENERAL_ERROR', data: null },
              { status: 500 }
            )
          : HttpResponse.json({
              event: 'APPLICATION_SUCCESS',
              data: { requests },
            })
      )
    );
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.pairing.pairs, { pages: [], pageParams: [] });
    const { result } = renderHook(
      () => {
        const query = useMyPendingRequests(true);
        return {
          data: query.data,
          isError: query.isError,
          refetch: query.refetch,
        };
      },
      { wrapper: createQueryWrapper(client) }
    );
    await waitFor(() => expect(result.current.data?.requests).toHaveLength(1));

    failed = true;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data?.requests).toEqual([request]);
    expect(client.getQueryState(queryKeys.pairing.pairs)?.isInvalidated).toBe(
      false
    );

    failed = false;
    requests = [];
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.pairing.pairs)?.isInvalidated).toBe(
        true
      )
    );
    await waitFor(() => expect(result.current.data?.requests).toEqual([]));
  });

  it('keeps an initially failed list unknown rather than supplying an empty list', async () => {
    mswServer.use(
      http.get(PENDING_URL, () =>
        HttpResponse.json(
          { event: 'GENERAL_ERROR', data: null },
          { status: 500 }
        )
      )
    );
    const { result } = renderHook(() => useMyPendingRequests(true), {
      wrapper: createQueryWrapper(makeTestQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

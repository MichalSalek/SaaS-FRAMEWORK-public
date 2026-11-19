// useChangeName.test.ts
// Contract test: characterises the cross-domain invalidation after the change-name mutation.
// A data-layer rewrite MUST keep this contract:
//   onSuccess → invalidateQueries(account.current) + invalidateQueries(public.stylistsListAll)
//
// Mocking strategy: MSW (HTTP level) intercepts POST /api/v1/user/change-name, so it stays stable
// across a rewrite of the data layer (URL level, not IO-function level).
// vi.spyOn(queryClient, 'invalidateQueries') stays: it checks the TQ lifecycle, not an IO mock.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  makeTestQueryClient,
  createQueryWrapper,
} from '../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../test-utils/msw/server';
import { useChangeName } from './useChangeName';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const CHANGE_NAME_URL = '*/api/v1/user/change-name';

// Success envelope per http.interceptor: { event, data: T }
const successResponse = (name: string) => ({
  event: 'USER_CHANGE_NAME',
  data: { name },
});

// Error envelope: status 500 makes the interceptor reject the Promise
const errorResponse = () => ({
  event: 'GENERAL_ERROR',
  data: null,
});

describe('useChangeName — cross-domain invalidacja (kontrakt DD3-F6)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('po sukcesie wywołuje invalidateQueries dla account.current', async () => {
    mswServer.use(
      http.post(CHANGE_NAME_URL, () =>
        HttpResponse.json(successResponse('TestUser'))
      )
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useChangeName(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ name: 'TestUser' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.account.current);
  });

  it('po sukcesie wywołuje invalidateQueries dla public.stylistsListAll', async () => {
    mswServer.use(
      http.post(CHANGE_NAME_URL, () =>
        HttpResponse.json(successResponse('TestUser'))
      )
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useChangeName(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ name: 'TestUser' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.public.stylistsListAll);
  });

  it('obie invalidacje (account.current + public.stylistsListAll) wywoływane po onSuccess', async () => {
    mswServer.use(
      http.post(CHANGE_NAME_URL, () =>
        HttpResponse.json(successResponse('BothUser'))
      )
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useChangeName(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ name: 'BothUser' });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);

    // Both keys must be in the list: invalidate-stylist-profile.helper.ts calls both void
    // invalidateQueries in sequence. If the helper is split or a key removed, one expect fails.
    expect(invalidatedKeys).toContainEqual(queryKeys.account.current);
    expect(invalidatedKeys).toContainEqual(queryKeys.public.stylistsListAll);
  });

  it('przy błędzie NIE wywołuje invalidateQueries', async () => {
    mswServer.use(
      http.post(CHANGE_NAME_URL, () =>
        HttpResponse.json(errorResponse(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useChangeName(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ name: 'ErrorUser' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(spy).not.toHaveBeenCalled();
  });
});

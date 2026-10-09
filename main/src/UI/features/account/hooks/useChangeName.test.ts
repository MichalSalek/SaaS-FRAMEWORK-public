// useChangeName.test.ts
// Contract test — W0.3 FDX FAZA 1
// Charakteryzacja cross-domain invalidacji po mutacji change-name.
// FAZA 2 (unifikacja data-layer) MUSI zachować ten kontrakt:
//   onSuccess → invalidateQueries(account.current) + invalidateQueries(public.stylistsListAll)
//
// Strategia mockowania: MSW (HTTP-level) — interceptuje POST /api/v1/user/change-name.
// Stabilny względem FAZA 2 przepisania data-layer (URL-level, nie IO-function-level).
// vi.spyOn(queryClient, 'invalidateQueries') ZOSTAJE — to nie mock-IO, to weryfikacja
// TQ lifecycle.

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

// Envelope sukcesu zgodnie z http.interceptor — { event, data: T }
const successResponse = (name: string) => ({
  event: 'USER_CHANGE_NAME',
  data: { name },
});

// Envelope błędu — status 500 powoduje odrzucenie Promise przez interceptor
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

    // Oba klucze muszą być w liście — helper invalidate-stylist-profile.helper.ts
    // woła oba void invalidateQueries sekwencyjnie. Ryzyko regresji FAZA 2:
    // jeśli helper zostanie rozbity lub klucz usunięty → jeden expect pęka → red.
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

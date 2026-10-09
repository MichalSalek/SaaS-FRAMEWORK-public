// useToggleLike.test.ts
// Contract test — W0.3 FDX FAZA 1
// Charakteryzacja optimistic update + rollback dla mutacji toggle-like.
// FAZA 2 MUSI zachować:
//   onMutate → natychmiastowy flip is_favorited w cache (przed odpowiedzią serwera)
//   onError  → rollback do snapshotu (snapshot undefined = rollback no-op → test łapie)
//   onSettled → invalidate detailKey + favorite.all + gallery.all
//
// Strategia: MSW (HTTP-level) — interceptuje POST /api/v1/favorite/add-record
//   i POST /api/v1/favorite/remove-record. Stabilny względem FAZA 2.
//
// Test A (optimistic timing): delay('infinite') wstrzymuje odpowiedź MSW,
// pozwalając sprawdzić flip cache zaraz po onMutate PRZED resolwem serwera.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import {
  makeTestQueryClient,
  createQueryWrapper,
} from '../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../test-utils/msw/server';
import { useToggleLike } from './useToggleLike';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import type { PhotoDetailData } from '../../shared/gallery/hooks/usePhotoDetail';

const ADD_FAVORITE_URL = '*/api/v1/favorite/add-record';
const REMOVE_FAVORITE_URL = '*/api/v1/favorite/remove-record';

const RECORD_ID = 'test-record-123';

// Minimalny kształt PhotoDetailData — hook sprawdza tylko is_favorited
const makeFakePhotoDetail = (is_favorited: boolean): PhotoDetailData =>
  ({
    gallery_record_id: RECORD_ID,
    is_favorited,
    stylist_info: { account_id: 'stylist-1', display_name: 'Test Stylist' },
  }) as unknown as PhotoDetailData;

// Envelope sukcesu zgodnie z http.interceptor — { event, data: T }
const successEnvelope = () => ({
  event: 'APPLICATION_SUCCESS',
  data: null,
});

// Envelope błędu
const errorEnvelope = () => ({
  event: 'CANNOT_ADD_RECORD_TO_FAVORITES',
  data: null,
});

describe('useToggleLike — optimistic update + rollback (kontrakt)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Test A — onMutate: natychmiastowy flip is_favorited false→true PRZED resolwem mutacji', async () => {
    // delay('infinite') wstrzymuje MSW handler — flip optimistyczny jest widoczny
    // przed resolwem serwera. onMutate (async cancelQueries) kończy się ZANIM
    // fetch wraca z serwera, więc waitFor łapie nowy stan cache.
    mswServer.use(
      http.post(ADD_FAVORITE_URL, async () => {
        await delay('infinite');
        return HttpResponse.json(successEnvelope());
      })
    );

    const queryClient = makeTestQueryClient();
    const detailKey = queryKeys.gallery.byId(RECORD_ID);

    // Seed: rekord NIE jest polubiony
    queryClient.setQueryData<PhotoDetailData>(
      detailKey,
      makeFakePhotoDetail(false)
    );

    const { result } = renderHook(() => useToggleLike(RECORD_ID), {
      wrapper: createQueryWrapper(queryClient),
    });

    // isFavorited=false → addFavorite, onMutate flip → true
    act(() => {
      result.current.mutate(false);
    });

    // onMutate jest async (await cancelQueries no-op w testowym kliencie).
    // delay('infinite') gwarantuje że handler nigdy nie odpowie w trakcie waitFor
    // → cache pokazuje wyłącznie stan po onMutate flip.
    await waitFor(() => {
      const cached = queryClient.getQueryData<PhotoDetailData>(detailKey);
      expect(cached?.is_favorited).toBe(true);
    });
  });

  it('Test A (variant) — flip true→false przy remove favorite', async () => {
    mswServer.use(
      http.post(REMOVE_FAVORITE_URL, () => HttpResponse.json(successEnvelope()))
    );

    const queryClient = makeTestQueryClient();
    const detailKey = queryKeys.gallery.byId(RECORD_ID);

    // Seed: rekord jest polubiony
    queryClient.setQueryData<PhotoDetailData>(
      detailKey,
      makeFakePhotoDetail(true)
    );

    const { result } = renderHook(() => useToggleLike(RECORD_ID), {
      wrapper: createQueryWrapper(queryClient),
    });

    // isFavorited=true → removeFavorite, onMutate flip → false
    act(() => {
      result.current.mutate(true);
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<PhotoDetailData>(detailKey);
      expect(cached?.is_favorited).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.isSuccess || result.current.isIdle).toBe(true);
    });
  });

  it('Test B — onError rollback: cache wraca do snapshotu po błędzie IO', async () => {
    mswServer.use(
      http.post(ADD_FAVORITE_URL, () =>
        HttpResponse.json(errorEnvelope(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    const detailKey = queryKeys.gallery.byId(RECORD_ID);

    // Seed: rekord NIE jest polubiony (snapshot = false)
    queryClient.setQueryData<PhotoDetailData>(
      detailKey,
      makeFakePhotoDetail(false)
    );

    const { result } = renderHook(() => useToggleLike(RECORD_ID), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(false);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Rollback: cache musi wrócić do is_favorited=false (stan sprzed onMutate)
    // RYZYKO FAZA 2: snapshot undefined → rollback no-op → cache zostaje z flip=true → test pęka RED
    const cached = queryClient.getQueryData<PhotoDetailData>(detailKey);
    expect(cached?.is_favorited).toBe(false);
  });

  it('Test B (undefined snapshot guard): onError bez danych w cache nie rzuca', async () => {
    // Scenariusz: cache pusty przed mutacją → snapshot=undefined
    // Hook ma guard: `if (context?.snapshot !== undefined)` → rollback no-op
    // Test weryfikuje że hook nie rzuca + isError=true
    mswServer.use(
      http.post(ADD_FAVORITE_URL, () =>
        HttpResponse.json(errorEnvelope(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    // Celowo NIE seedujemy cache → snapshot w onMutate będzie undefined

    const { result } = renderHook(() => useToggleLike(RECORD_ID), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(false);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Brak throw → hook obsługuje undefined snapshot gracefully
    expect(result.current.isError).toBe(true);
  });

  it('onSettled invaliduje detailKey, favorite.all i gallery.all po sukcesie', async () => {
    mswServer.use(
      http.post(ADD_FAVORITE_URL, () => HttpResponse.json(successEnvelope()))
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const detailKey = queryKeys.gallery.byId(RECORD_ID);

    queryClient.setQueryData<PhotoDetailData>(
      detailKey,
      makeFakePhotoDetail(false)
    );

    const { result } = renderHook(() => useToggleLike(RECORD_ID), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(false);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(detailKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.favorite.all);
    expect(invalidatedKeys).toContainEqual(queryKeys.gallery.all);
  });

  it('onSettled invaliduje detailKey, favorite.all i gallery.all po błędzie', async () => {
    mswServer.use(
      http.post(ADD_FAVORITE_URL, () =>
        HttpResponse.json(errorEnvelope(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const detailKey = queryKeys.gallery.byId(RECORD_ID);

    queryClient.setQueryData<PhotoDetailData>(
      detailKey,
      makeFakePhotoDetail(false)
    );

    const { result } = renderHook(() => useToggleLike(RECORD_ID), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(false);
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // onSettled jest wywoływane zawsze (sukces i błąd)
    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(detailKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.favorite.all);
    expect(invalidatedKeys).toContainEqual(queryKeys.gallery.all);
  });
});

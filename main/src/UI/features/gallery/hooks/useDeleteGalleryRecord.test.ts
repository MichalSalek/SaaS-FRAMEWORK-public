// useDeleteGalleryRecord.test.ts
// Contract test — W0.3 FDX FAZA 1
// Charakteryzacja mutacji delete z optimistic update + rollback + snackbar.
// FAZA 2 MUSI zachować:
//   onMutate → snapshot wszystkich gallery caches, optimistic remove rekordu
//   onError  → rollback snapshotu (toast błędu należy do HTTP interceptora, NIE hooka)
//   onSettled → invalidate gallery.all + account.dashboardFeed + account.usageStats
//
// Strategia: MSW (HTTP-level) — interceptuje POST /api/v1/gallery/delete-record.
// Stabilny względem FAZA 2 przepisania data-layer (URL-level, nie IO-function-level).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse, delay } from 'msw';
import {
  makeTestQueryClient,
  createQueryWrapper,
} from '../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../test-utils/msw/server';
import { useDeleteGalleryRecord } from './useDeleteGalleryRecord';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import * as appSnackbarApi from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import type { GALLERY_DTO_API_V1 } from '../../../../READONLY-shared-kernel/models/gallery/gallery.dto';
import type { InfiniteData } from '@tanstack/react-query';

const DELETE_RECORD_URL = '*/api/v1/gallery/delete-record';

type GalleryResponse = GALLERY_DTO_API_V1['GET_GALLERY_RECORDS']['RESPONSE'];
type GalleryInfiniteData = InfiniteData<GalleryResponse>;

const RECORD_ID_DELETE = 'record-to-delete-abc';
const RECORD_ID_KEEP = 'record-to-keep-xyz';

// Envelope sukcesu zgodnie z http.interceptor — { event, data: T }
const successEnvelope = () => ({
  event: 'APPLICATION_SUCCESS',
  data: null,
});

// Envelope błędu (dowolny błędny event — hook rolluje na każdym błędzie HTTP;
// toast błędu należy do interceptora, nie do hooka)
const errorEnvelope = () => ({
  event: 'GENERAL_ERROR',
  data: null,
});

// Buduje InfiniteData z jedną stroną
const makeGalleryInfiniteData = (recordIds: string[]): GalleryInfiniteData => ({
  pages: [
    {
      records: recordIds.map(id => ({
        gallery_record_id: id,
        image_url: `https://example.com/${id}.jpg`,
      })),
      nextCursor: null,
    } as unknown as GalleryResponse,
  ],
  pageParams: [null],
});

describe('useDeleteGalleryRecord — optimistic delete + rollback + snackbar (kontrakt)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy-path: mutacja kończy się isSuccess po DELETE', async () => {
    mswServer.use(
      http.post(DELETE_RECORD_URL, () => HttpResponse.json(successEnvelope()))
    );

    const queryClient = makeTestQueryClient();
    const { result } = renderHook(() => useDeleteGalleryRecord(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ gallery_record_id: RECORD_ID_DELETE });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it('onSettled invaliduje gallery.all, account.dashboardFeed, account.usageStats', async () => {
    mswServer.use(
      http.post(DELETE_RECORD_URL, () => HttpResponse.json(successEnvelope()))
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteGalleryRecord(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ gallery_record_id: RECORD_ID_DELETE });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(queryKeys.gallery.all);
    expect(invalidatedKeys).toContainEqual(queryKeys.account.dashboardFeed);
    expect(invalidatedKeys).toContainEqual(queryKeys.account.usageStats);
  });

  it('onMutate: rekord jest usuwany optimistycznie z cache InfiniteData', async () => {
    // delay('infinite') wstrzymuje odpowiedź MSW — sprawdzamy optimistic state
    // PRZED resolwem serwera. onMutate (sync snapshot + optimistic remove) wykonuje się
    // synchronicznie zanim fetch wróci, więc waitFor łapie stan po flip.
    mswServer.use(
      http.post(DELETE_RECORD_URL, async () => {
        await delay('infinite');
        return HttpResponse.json(successEnvelope());
      })
    );

    const queryClient = makeTestQueryClient();
    const galleryKey = queryKeys.gallery.records({
      gallery_record_id: undefined,
      color_ids: [],
      trait_ids: [],
      apply_strict_filter: false,
      cursor: undefined,
      take: 20,
    });

    // Seed cache: dwa rekordy
    queryClient.setQueryData<GalleryInfiniteData>(
      galleryKey,
      makeGalleryInfiniteData([RECORD_ID_DELETE, RECORD_ID_KEEP])
    );

    const { result } = renderHook(() => useDeleteGalleryRecord(), {
      wrapper: createQueryWrapper(queryClient),
    });

    act(() => {
      result.current.mutate({ gallery_record_id: RECORD_ID_DELETE });
    });

    // Sprawdzamy optimistic remove przed resolwem IO
    await waitFor(() => {
      const cached = queryClient.getQueryData<GalleryInfiniteData>(galleryKey);
      const ids = cached?.pages.flatMap(p =>
        (
          p as unknown as { records: { gallery_record_id: string }[] }
        ).records.map(r => r.gallery_record_id)
      );
      expect(ids).not.toContain(RECORD_ID_DELETE);
      expect(ids).toContain(RECORD_ID_KEEP);
    });
  });

  it('onError rollback: oba rekordy wracają do cache po błędzie', async () => {
    mswServer.use(
      http.post(DELETE_RECORD_URL, () =>
        HttpResponse.json(errorEnvelope(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    const galleryKey = queryKeys.gallery.records({
      gallery_record_id: undefined,
      color_ids: [],
      trait_ids: [],
      apply_strict_filter: false,
      cursor: undefined,
      take: 20,
    });

    queryClient.setQueryData<GalleryInfiniteData>(
      galleryKey,
      makeGalleryInfiniteData([RECORD_ID_DELETE, RECORD_ID_KEEP])
    );

    const { result } = renderHook(() => useDeleteGalleryRecord(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ gallery_record_id: RECORD_ID_DELETE });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Rollback: oba rekordy muszą być w cache
    const cached = queryClient.getQueryData<GalleryInfiniteData>(galleryKey);
    const ids = cached?.pages.flatMap(p =>
      (
        p as unknown as { records: { gallery_record_id: string }[] }
      ).records.map(r => r.gallery_record_id)
    );
    expect(ids).toContain(RECORD_ID_DELETE);
    expect(ids).toContain(RECORD_ID_KEEP);
  });

  it('onError: hook NIE dokłada drugiego toasta — interceptor pushuje błąd RAZ', async () => {
    // Double-toast fix (turbo-review S75): hook usunął własny push
    // CANNOT_DELETE_GALLERY_RECORD. HTTP interceptor (event-bus Stage 1) — który
    // odpala się nawet w tym unit-teście przez callHTTPEndpoint nad MSW — jest
    // JEDYNYM właścicielem toasta błędu: pushuje event z envelope (GENERAL_ERROR)
    // dokładnie RAZ. Hook robi tylko rollback. Ratchet: przywrócenie lokalnego
    // push podniosłoby licznik do 2 (dawny double-toast) i ten test by padł.
    mswServer.use(
      http.post(DELETE_RECORD_URL, () =>
        HttpResponse.json(errorEnvelope(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    const snackbarSpy = vi.spyOn(appSnackbarApi, 'pushNewSnackbar');

    const { result } = renderHook(() => useDeleteGalleryRecord(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ gallery_record_id: RECORD_ID_DELETE });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(snackbarSpy).toHaveBeenCalledTimes(1);
    expect(snackbarSpy).toHaveBeenCalledWith('GENERAL_ERROR', 'error');
  });

  it('onSettled invaliduje gallery.all po błędzie (zawsze)', async () => {
    mswServer.use(
      http.post(DELETE_RECORD_URL, () =>
        HttpResponse.json(errorEnvelope(), { status: 500 })
      )
    );

    const queryClient = makeTestQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteGalleryRecord(), {
      wrapper: createQueryWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate({ gallery_record_id: RECORD_ID_DELETE });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const invalidatedKeys = spy.mock.calls.map(call => call[0]?.queryKey);
    // onSettled jest wywoływane niezależnie od sukcesu/błędu
    expect(invalidatedKeys).toContainEqual(queryKeys.gallery.all);
    expect(invalidatedKeys).toContainEqual(queryKeys.account.dashboardFeed);
    expect(invalidatedKeys).toContainEqual(queryKeys.account.usageStats);
  });
});

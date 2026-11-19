import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../../application/http/queryKeys.factory';

const mocks = vi.hoisted(() => ({
  vendor: vi.fn(),
  create: vi.fn(),
  discard: vi.fn(),
  session: { isPending: false, error: null, data: { user: { id: 'a' } } },
}));
vi.mock('../../../../domain/gallery/galleryIO.possibilities.api', () => ({
  uploadImageToVendor_IO: mocks.vendor,
  createGalleryRecord_IO: mocks.create,
  deleteAssetByToken_IO: mocks.discard,
}));
vi.mock('../../../../application/auth/better-auth-client', () => ({
  authClient: { useSession: () => mocks.session },
}));
vi.mock(
  '../../../../application/error-debugger/errorHandler.possibilities.api',
  () => ({ reportIssueFrontend: vi.fn() })
);
import { useUploadGalleryRecord } from './useUploadGalleryRecord';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('authorization', 'token-a');
  mocks.session.data.user.id = 'a';
  mocks.vendor.mockReset();
  mocks.create.mockReset();
  mocks.discard.mockReset().mockResolvedValue(true);
});

describe('gallery upload identity', () => {
  it('keeps the confirmed gallery record available to the success screen', async () => {
    mocks.vendor.mockResolvedValueOnce({
      secure_url: 'https://example.test/image',
    });
    mocks.create.mockResolvedValueOnce({ gallery_record_id: 'gallery-a' });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(queryKeys.account.current, {
      id: 'a',
      stylist_account: { account_id: 'account-a' },
    });
    const view = renderHook(() => useUploadGalleryRecord(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    await act(async () => {
      await view.result.current.mutateAsync({
        file: new File(['a'], 'a.jpg'),
        color_ids: [],
        trait_ids: [],
        nail_length: 'SHORT',
      });
    });
    await waitFor(() =>
      expect(view.result.current.data?.gallery_record_id).toBe('gallery-a')
    );
    expect(view.result.current.uploadProgress).toBe('done');
  });
  it('does not attach a photo to the next account after a delayed vendor upload', async () => {
    let finish!: (value: { secure_url: string; delete_token: string }) => void;
    mocks.vendor.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(queryKeys.account.current, {
      id: 'a',
      stylist_account: { account_id: 'account-a' },
    });
    const view = renderHook(() => useUploadGalleryRecord(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    let pending!: Promise<unknown>;
    act(() => {
      pending = view.result.current.mutateAsync({
        file: new File(['a'], 'a.jpg'),
        color_ids: [],
        trait_ids: [],
        nail_length: 'SHORT',
      });
    });
    await waitFor(() => expect(mocks.vendor).toHaveBeenCalledOnce());
    localStorage.setItem('authorization', 'token-b');
    mocks.session.data.user.id = 'b';
    client.setQueryData(queryKeys.account.current, {
      id: 'b',
      stylist_account: { account_id: 'account-b' },
    });
    view.rerender();
    await act(async () => {
      finish({
        secure_url: 'https://example.test/image',
        delete_token: 'draft-token',
      });
      await pending.catch(() => undefined);
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.discard).toHaveBeenCalledWith('draft-token');
  });

  it('does not confirm or update the next account when the save response arrives late', async () => {
    mocks.vendor.mockResolvedValueOnce({
      secure_url: 'https://example.test/image',
      delete_token: 'draft-token',
    });
    let finish!: (value: object) => void;
    mocks.create.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    client.setQueryData(queryKeys.account.current, {
      id: 'a',
      stylist_account: { account_id: 'account-a' },
    });
    const view = renderHook(() => useUploadGalleryRecord(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    let pending!: ReturnType<typeof view.result.current.mutateAsync>;
    act(() => {
      pending = view.result.current.mutateAsync({
        file: new File(['a'], 'a.jpg'),
        color_ids: [],
        trait_ids: [],
        nail_length: 'SHORT',
      });
    });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    localStorage.setItem('authorization', 'token-b');
    mocks.session.data.user.id = 'b';
    client.setQueryData(queryKeys.account.current, {
      id: 'b',
      stylist_account: { account_id: 'account-b' },
    });
    client.setQueryData(queryKeys.account.usageStats, { gallery_records: 9 });
    view.rerender();
    await act(async () => {
      finish({});
    });
    const result = await pending;
    expect(result.isCurrent()).toBe(false);
    expect(client.getQueryData(queryKeys.account.usageStats)).toMatchObject({
      gallery_records: 9,
    });
    expect(view.result.current.uploadProgress).not.toBe('done');
    expect(mocks.discard).not.toHaveBeenCalled();
  });
});

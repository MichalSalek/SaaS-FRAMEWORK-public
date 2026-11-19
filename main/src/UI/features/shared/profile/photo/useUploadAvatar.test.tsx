import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import { useUploadAvatar } from './useUploadAvatar';

const mocks = vi.hoisted(() => ({
  vendor: vi.fn(),
  person: vi.fn(),
  logo: vi.fn(),
  deleteDraft: vi.fn(),
  snackbar: vi.fn(),
  session: {
    isPending: false,
    error: null as null | Error,
    data: { user: { id: 'a' } },
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock(
  '../../../../../application/app-snackbar/appSnackbar.possibilities.api',
  () => ({ pushNewSnackbar: mocks.snackbar })
);
vi.mock('../../../../../domain/gallery/galleryIO.possibilities.api', () => ({
  uploadImageToVendor_IO: mocks.vendor,
  deleteAssetByToken_IO: mocks.deleteDraft,
}));
vi.mock('../../../../../domain/user/userIO.possibilities.api', () => ({
  setUserAvatar_IO: mocks.person,
}));
vi.mock(
  '../../../../../domain/salon-profile/salonProfileIO.possibilities.api',
  () => ({ setSalonLogo_IO: mocks.logo })
);
vi.mock('../../../../../application/auth/better-auth-client', () => ({
  authClient: { useSession: () => mocks.session },
}));
vi.mock(
  '../../../../../application/error-debugger/errorHandler.possibilities.api',
  () => ({ reportIssueFrontend: vi.fn() })
);
vi.mock('../../analytics/flowErrorCode', () => ({
  flowErrorCode: () => 'error',
}));
vi.mock('../../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(target: 'person' | 'logo') {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.account.current, {
    id: 'a',
    avatar_url: 'old',
    stylist_account: { account_id: 'salon-a' },
  });
  client.setQueryData(queryKeys.salon.mine, {
    account_id: 'salon-a',
    logo_url: 'old-logo',
  });
  const hook = renderHook(() => useUploadAvatar(target), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const switchToB = () => {
    localStorage.setItem('authorization', 'token-b');
    mocks.session.data.user.id = 'b';
    client.setQueryData(queryKeys.account.current, {
      id: 'b',
      avatar_url: 'b-photo',
      stylist_account: { account_id: 'salon-b' },
    });
    client.setQueryData(queryKeys.salon.mine, {
      account_id: 'salon-b',
      logo_url: 'b-logo',
    });
    hook.rerender();
  };
  return { client, hook, switchToB };
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('authorization', 'token-a');
  mocks.session.isPending = false;
  mocks.session.error = null;
  mocks.session.data.user.id = 'a';
  mocks.vendor.mockReset();
  mocks.person.mockReset();
  mocks.logo.mockReset();
  mocks.deleteDraft.mockReset().mockResolvedValue(true);
  mocks.snackbar.mockReset();
});
describe('avatar upload identity', () => {
  it.each(['person', 'logo'] as const)(
    'saves a %s normally for the verified identity',
    async target => {
      mocks.vendor.mockResolvedValue({
        secure_url: 'new',
        delete_token: 'draft-token',
      });
      mocks.person.mockResolvedValue({ user_id: 'a', avatar_url: 'new' });
      mocks.logo.mockResolvedValue({ logo_url: 'new' });
      const { hook, client } = setup(target);
      await act(async () => {
        await hook.result.current.upload.mutateAsync(new File(['a'], 'a.jpg'));
      });
      expect(
        target === 'person' ? mocks.person : mocks.logo
      ).toHaveBeenCalledOnce();
      expect(
        client.getQueryData(
          target === 'person' ? queryKeys.account.current : queryKeys.salon.mine
        )
      ).toMatchObject(
        target === 'person' ? { avatar_url: 'new' } : { logo_url: 'new' }
      );
      expect(mocks.deleteDraft).not.toHaveBeenCalled();
    }
  );
  it.each(['person', 'logo'] as const)(
    'does not attach a %s upload after the session changes',
    async target => {
      const vendor = deferred<{ secure_url: string; delete_token: string }>();
      mocks.vendor.mockReturnValue(vendor.promise);
      mocks.person.mockResolvedValue({ user_id: 'b', avatar_url: 'new' });
      mocks.logo.mockResolvedValue({ logo_url: 'new' });
      const { hook, switchToB } = setup(target);
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.upload.mutateAsync(
          new File(['a'], 'a.jpg')
        );
      });
      await waitFor(() => expect(mocks.vendor).toHaveBeenCalledOnce());
      switchToB();
      await act(async () => {
        vendor.resolve({ secure_url: 'new', delete_token: 'draft-token' });
        await pending.catch(() => undefined);
      });
      expect(mocks.person).not.toHaveBeenCalled();
      expect(mocks.logo).not.toHaveBeenCalled();
      expect(mocks.deleteDraft).toHaveBeenCalledWith('draft-token');
    }
  );
  it.each(['person', 'logo'] as const)(
    'does not patch the next identity after an in-flight %s removal',
    async target => {
      const response = deferred<
        { user_id: string; avatar_url: null } | { logo_url: null }
      >();
      mocks.person.mockReturnValue(response.promise);
      mocks.logo.mockReturnValue(response.promise);
      const { hook, client, switchToB } = setup(target);
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.remove.mutateAsync();
      });
      await waitFor(() =>
        expect(
          target === 'person' ? mocks.person : mocks.logo
        ).toHaveBeenCalledOnce()
      );
      switchToB();
      await act(async () => {
        response.resolve(
          target === 'person'
            ? { user_id: 'a', avatar_url: null }
            : { logo_url: null }
        );
        await pending;
      });
      expect(client.getQueryData(queryKeys.account.current)).toMatchObject({
        id: 'b',
        avatar_url: 'b-photo',
      });
      expect(client.getQueryData(queryKeys.salon.mine)).toMatchObject({
        account_id: 'salon-b',
        logo_url: 'b-logo',
      });
    }
  );
  it.each(['person', 'logo'] as const)(
    'does not patch or delete a committed %s when its response arrives after account switch',
    async target => {
      const response = deferred<
        { user_id: string; avatar_url: string } | { logo_url: string }
      >();
      mocks.vendor.mockResolvedValue({
        secure_url: 'new',
        delete_token: 'draft-token',
      });
      mocks.person.mockReturnValue(response.promise);
      mocks.logo.mockReturnValue(response.promise);
      const { hook, client, switchToB } = setup(target);
      let pending!: Promise<unknown>;
      act(() => {
        pending = hook.result.current.upload.mutateAsync(
          new File(['a'], 'a.jpg')
        );
      });
      await waitFor(() =>
        expect(
          target === 'person' ? mocks.person : mocks.logo
        ).toHaveBeenCalledOnce()
      );
      switchToB();
      await act(async () => {
        response.resolve(
          target === 'person'
            ? { user_id: 'a', avatar_url: 'new' }
            : { logo_url: 'new' }
        );
        await pending;
      });
      expect(client.getQueryData(queryKeys.account.current)).toMatchObject({
        id: 'b',
        avatar_url: 'b-photo',
      });
      expect(client.getQueryData(queryKeys.salon.mine)).toMatchObject({
        account_id: 'salon-b',
        logo_url: 'b-logo',
      });
      expect(mocks.deleteDraft).not.toHaveBeenCalled();
    }
  );
  it('rejects an upload when the token changes before session data catches up', async () => {
    const vendor = deferred<{ secure_url: string; delete_token: string }>();
    mocks.vendor.mockReturnValue(vendor.promise);
    const { hook } = setup('person');
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.upload.mutateAsync(
        new File(['a'], 'a.jpg')
      );
    });
    await waitFor(() => expect(mocks.vendor).toHaveBeenCalledOnce());
    localStorage.setItem('authorization', 'token-b');
    await act(async () => {
      vendor.resolve({ secure_url: 'new', delete_token: 'draft-token' });
      await pending.catch(() => undefined);
    });
    expect(mocks.person).not.toHaveBeenCalled();
  });
  it('does not delete a possibly committed file when the profile response is lost after unmount', async () => {
    let reject!: (error: Error) => void;
    const response = new Promise((_resolve, fail) => {
      reject = fail;
    });
    mocks.vendor.mockResolvedValue({
      secure_url: 'new',
      delete_token: 'draft-token',
    });
    mocks.person.mockReturnValue(response);
    const { hook } = setup('person');
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.upload.mutateAsync(
        new File(['a'], 'a.jpg')
      );
    });
    await waitFor(() => expect(mocks.person).toHaveBeenCalledOnce());
    hook.unmount();
    await act(async () => {
      reject(new Error('response lost'));
      await pending.catch(() => undefined);
    });
    expect(mocks.deleteDraft).not.toHaveBeenCalled();
  });
  it('reports an unavailable session when removing a photo', async () => {
    const { hook } = setup('person');
    mocks.session.isPending = true;
    hook.rerender();
    await act(async () => {
      await hook.result.current.remove.mutateAsync().catch(() => undefined);
    });
    expect(mocks.person).not.toHaveBeenCalled();
    expect(mocks.snackbar).toHaveBeenCalledWith('saveFailed', 'error');
  });
});

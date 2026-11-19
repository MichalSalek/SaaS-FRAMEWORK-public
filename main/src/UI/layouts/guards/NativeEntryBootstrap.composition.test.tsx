import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { runInNewContext } from 'node:vm';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import { ZERO_FLASH_SCRIPT } from '../../../application/client-device-storage/zero-flash-script';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';

const harness = vi.hoisted(() => ({
  router: {
    pathname: '/',
    asPath: '/?platform=android',
    isReady: true,
    locale: 'pl',
    replace: vi.fn(async () => true),
  },
  session: {
    data: null as null | { user: { id: string } },
    isPending: false,
    isRefetching: false,
  },
  getSession: vi.fn(),
  hydrateSession: vi.fn(),
}));

vi.mock('next/router', () => ({
  useRouter: () => harness.router,
}));

vi.mock('../../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => harness.session,
    getSession: harness.getSession,
    hydrateSession: harness.hydrateSession,
  },
}));

import { NativeEntryBootstrapComposition } from './NativeEntryBootstrap.composition';
import {
  completeNativeStartup,
  NATIVE_STARTUP_TIMEOUT_MS,
  isNativeStartupPending,
  onNativeStartupReady,
} from '../../../application/lifecycle/native-startup';

const MESSAGES = {
  events: {
    AUTH_UNAVAILABLE: 'Nie możemy teraz potwierdzić logowania.',
  },
  errors: {
    tryAgain: 'Spróbuj ponownie',
  },
};

function runNativeHomePrepaint(): void {
  runInNewContext(ZERO_FLASH_SCRIPT, {
    document: { documentElement: document.documentElement },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    window: {
      matchMedia: () => ({ matches: false }),
      location: { pathname: '/', search: '?platform=android', hash: '' },
    },
    URLSearchParams,
  });
}

function renderBootstrap() {
  return renderWithProviders(
    <NativeEntryBootstrapComposition>
      <div>PROTECTED PAGE MOUNTED</div>
    </NativeEntryBootstrapComposition>,
    { messages: MESSAGES }
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/?platform=android');
  harness.router.pathname = '/';
  harness.router.asPath = '/?platform=android';
  harness.router.isReady = true;
  harness.router.replace.mockReset();
  harness.router.replace.mockResolvedValue(true);
  harness.session.data = null;
  harness.session.isPending = false;
  harness.session.isRefetching = false;
  harness.getSession.mockReset();
  harness.hydrateSession.mockReset();
});

afterEach(() => {
  completeNativeStartup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('NativeEntryBootstrap', () => {
  it('routes a tokenless native cold start to welcome without an auth request', async () => {
    renderBootstrap();

    await waitFor(() =>
      expect(harness.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.WELCOME)
    );
    expect(harness.getSession).not.toHaveBeenCalled();
    expect(
      screen.queryByText('PROTECTED PAGE MOUNTED')
    ).not.toBeInTheDocument();
  });

  it('releases the splash into a retry screen if route navigation stalls', async () => {
    vi.useFakeTimers();
    harness.router.replace.mockImplementation(() => new Promise(() => {}));

    renderBootstrap();
    expect(isNativeStartupPending()).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_STARTUP_TIMEOUT_MS);
    });

    expect(
      screen.getByRole('button', { name: 'Spróbuj ponownie' })
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(isNativeStartupPending()).toBe(false);
  });

  it('keeps AppLifecycle waiting until router readiness and the resolved route commit', async () => {
    runNativeHomePrepaint();
    expect(isNativeStartupPending()).toBe(true);
    const hideSplash = vi.fn();
    const unsubscribe = onNativeStartupReady(hideSplash);
    harness.router.isReady = false;
    const { rerender } = renderBootstrap();
    expect(hideSplash).not.toHaveBeenCalled();

    harness.router.isReady = true;
    rerender(
      <NativeEntryBootstrapComposition>
        <div>PROTECTED PAGE MOUNTED</div>
      </NativeEntryBootstrapComposition>
    );
    await waitFor(() =>
      expect(harness.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.WELCOME)
    );
    expect(hideSplash).not.toHaveBeenCalled();

    harness.router.pathname = ROUTES_FRONT.WELCOME;
    rerender(
      <NativeEntryBootstrapComposition>
        <div>PROTECTED PAGE MOUNTED</div>
      </NativeEntryBootstrapComposition>
    );
    await waitFor(() => expect(hideSplash).toHaveBeenCalledTimes(1));
    unsubscribe();
  });

  it('releases splash to retry if the router never reports readiness', async () => {
    vi.useFakeTimers();
    runNativeHomePrepaint();
    harness.router.isReady = false;
    const hideSplash = vi.fn();
    const unsubscribe = onNativeStartupReady(hideSplash);

    renderBootstrap();
    expect(hideSplash).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_STARTUP_TIMEOUT_MS);
    });
    expect(
      screen.getByRole('button', { name: 'Spróbuj ponownie' })
    ).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(isNativeStartupPending()).toBe(false);
    expect(hideSplash).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not guess that the token is absent when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError');
    });

    renderBootstrap();

    expect(
      await screen.findByRole('button', { name: 'Spróbuj ponownie' })
    ).toBeInTheDocument();
    expect(harness.router.replace).not.toHaveBeenCalled();
    expect(harness.getSession).not.toHaveBeenCalled();
    await waitFor(() => expect(isNativeStartupPending()).toBe(false));
  });

  it('does not mount the protected page until the stored token has a positive server verdict', async () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'valid-token');
    harness.getSession.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const { rerender } = renderBootstrap();

    expect(
      screen.queryByText('PROTECTED PAGE MOUNTED')
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(harness.getSession).toHaveBeenCalledWith({
        fetchOptions: {
          auth: { type: 'Bearer', token: 'valid-token' },
        },
      })
    );
    await waitFor(() =>
      expect(harness.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.APP)
    );
    expect(harness.hydrateSession).toHaveBeenCalledWith({
      user: { id: 'user-1' },
    });
    expect(
      screen.queryByText('PROTECTED PAGE MOUNTED')
    ).not.toBeInTheDocument();

    harness.router.pathname = ROUTES_FRONT.APP;
    harness.router.asPath = ROUTES_FRONT.APP;
    rerender(
      <NativeEntryBootstrapComposition>
        <div>PROTECTED PAGE MOUNTED</div>
      </NativeEntryBootstrapComposition>
    );

    expect(
      await screen.findByText('PROTECTED PAGE MOUNTED')
    ).toBeInTheDocument();
  });

  it('sends an explicit 401 to welcome and tears down only the rejected stored token', async () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'expired-token');
    harness.getSession.mockResolvedValue({
      data: null,
      error: { status: 401 },
    });

    renderBootstrap();

    await waitFor(() =>
      expect(harness.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.WELCOME)
    );
    expect(localStorage.getItem(CUSTOM_HEADERS.authorization)).toBeNull();
    expect(
      screen.queryByText('PROTECTED PAGE MOUNTED')
    ).not.toBeInTheDocument();
  });

  it('keeps the token and offers retry when the session service is unavailable', async () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'temporary-token');
    harness.getSession.mockResolvedValue({
      data: null,
      error: { status: 503 },
    });

    renderBootstrap();

    expect(
      await screen.findByRole('button', { name: 'Spróbuj ponownie' })
    ).toBeInTheDocument();
    expect(localStorage.getItem(CUSTOM_HEADERS.authorization)).toBe(
      'temporary-token'
    );
    expect(harness.router.replace).not.toHaveBeenCalled();

    harness.getSession.mockResolvedValue({
      data: null,
      error: { status: 503 },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => expect(harness.getSession).toHaveBeenCalledTimes(2));
    expect(localStorage.getItem(CUSTOM_HEADERS.authorization)).toBe(
      'temporary-token'
    );
  });

  it('ignores a validation response that arrives after the startup timeout', async () => {
    vi.useFakeTimers();
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'slow-token');
    let finish!: (value: { data: null; error: { status: number } }) => void;
    harness.getSession.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );

    renderBootstrap();
    expect(harness.getSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NATIVE_STARTUP_TIMEOUT_MS);
    });
    expect(
      screen.getByRole('button', { name: 'Spróbuj ponownie' })
    ).toBeInTheDocument();

    await act(async () => {
      finish({ data: null, error: { status: 401 } });
    });
    expect(localStorage.getItem(CUSTOM_HEADERS.authorization)).toBe(
      'slow-token'
    );
    expect(harness.router.replace).not.toHaveBeenCalled();
  });

  it('ignores a late rejection for an old token and validates the newer token', async () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'old-token');
    let rejectOld!: (value: { data: null; error: { status: number } }) => void;
    harness.getSession
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            rejectOld = resolve;
          })
      )
      .mockResolvedValueOnce({
        data: { user: { id: 'new-user' } },
        error: null,
      });

    const { rerender } = renderBootstrap();
    await waitFor(() => expect(harness.getSession).toHaveBeenCalledTimes(1));

    localStorage.setItem(CUSTOM_HEADERS.authorization, 'new-token');
    rejectOld({ data: null, error: { status: 401 } });

    await waitFor(() => expect(harness.getSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(harness.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.APP)
    );
    expect(localStorage.getItem(CUSTOM_HEADERS.authorization)).toBe(
      'new-token'
    );

    harness.router.pathname = ROUTES_FRONT.APP;
    harness.router.asPath = ROUTES_FRONT.APP;
    rerender(
      <NativeEntryBootstrapComposition>
        <div>PROTECTED PAGE MOUNTED</div>
      </NativeEntryBootstrapComposition>
    );
    expect(
      await screen.findByText('PROTECTED PAGE MOUNTED')
    ).toBeInTheDocument();
  });

  it('does not intercept an intentional home visit', async () => {
    localStorage.setItem(CUSTOM_HEADERS.authorization, 'valid-token');
    sessionStorage.setItem(STORAGE_KEYS.NATIVE_ENTRY_RESOLVED, '1');
    harness.getSession.mockResolvedValue({ data: null, error: null });

    renderBootstrap();

    expect(
      await screen.findByText('PROTECTED PAGE MOUNTED')
    ).toBeInTheDocument();
    expect(harness.getSession).not.toHaveBeenCalled();
    expect(harness.router.replace).not.toHaveBeenCalled();
  });

  it.each(['authCode=one-time', 'qrCode=pairing'])(
    'preserves explicit native target %s',
    async query => {
      localStorage.setItem(CUSTOM_HEADERS.authorization, 'valid-token');
      window.history.replaceState({}, '', `/?platform=android&${query}`);

      renderBootstrap();

      expect(
        await screen.findByText('PROTECTED PAGE MOUNTED')
      ).toBeInTheDocument();
      expect(harness.getSession).not.toHaveBeenCalled();
      expect(harness.router.replace).not.toHaveBeenCalled();
    }
  );
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  refetch: vi.fn(async () => undefined),
  getSession: vi.fn(async () => ({
    data: { user: { email: 'new@example.com' } },
    error: null,
  })),
}));
vi.mock('../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: null,
      isPending: false,
      error: null,
      refetch: mocks.refetch,
    }),
    getSession: mocks.getSession,
  },
  signOut: vi.fn(),
}));
vi.mock('../../domain/auth/authIO.possibilities.api', () => ({
  exchangeAuthCode_IO: mocks.exchange,
}));
vi.mock('./clearPurchaseIdentity', () => ({ clearPurchaseIdentity: () => {} }));
vi.mock('./useSessionRecovery', () => ({ useSessionRecovery: () => {} }));
vi.mock('../../domain/notifications/push/sign-out-with-push', () => ({
  signOutAndForgetPushDevice: async () => {},
}));
vi.mock('../shared/hooks/useCurrentUserAccount', () => ({
  useCachedCurrentUser: () => undefined,
}));
import { AuthProviderComposition, useAuth } from './AuthContext.composition';
import { markLoginStarted } from '../../application/auth/login-confirmation';
function Probe() {
  const auth = useAuth();
  return (
    <span>
      {auth.loginConfirmation ? 'confirm-required' : 'no-confirmation'}
    </span>
  );
}
describe('fresh login concurrency', () => {
  it('does not silently replace a token saved while exchange was in flight', async () => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/app?authCode=abc');
    markLoginStarted();
    let resolve!: (value: string) => void;
    mocks.exchange.mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <AuthProviderComposition>
          <Probe />
        </AuthProviderComposition>
      </QueryClientProvider>
    );
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledOnce());
    localStorage.setItem('authorization', 'other-tab-token');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'authorization',
          newValue: 'other-tab-token',
        })
      );
    });
    await act(async () => {
      resolve('new-login-token');
    });
    expect(localStorage.getItem('authorization')).toBe('other-tab-token');
    await waitFor(() =>
      expect(screen.getByText('confirm-required')).toBeInTheDocument()
    );
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  exchange: vi.fn(),
  refetch: vi.fn(async () => undefined),
}));
vi.mock('../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: null,
      isPending: false,
      error: null,
      refetch: mocks.refetch,
    }),
    getSession: vi.fn(async () => ({ data: null })),
  },
  signOut: vi.fn(),
}));
vi.mock('../../domain/auth/authIO.possibilities.api', () => ({
  exchangeAuthCode_IO: mocks.exchange,
}));
vi.mock('./useDocumentCredentialsGuard', () => ({
  useDocumentCredentialsGuard: () => {},
}));
vi.mock('./clearPurchaseIdentity', () => ({ clearPurchaseIdentity: () => {} }));
vi.mock('./useSessionRecovery', () => ({ useSessionRecovery: () => {} }));
vi.mock('../shared/hooks/useCurrentUserAccount', () => ({
  useCachedCurrentUser: () => undefined,
}));
vi.mock('../../domain/notifications/push/sign-out-with-push', () => ({
  signOutAndForgetPushDevice: async () => {},
}));
import { checkedDocumentCredentials } from '../../application/auth/document-credentials';
import { markLoginStarted } from '../../application/auth/login-confirmation';
import { AuthProviderComposition, useAuth } from './AuthContext.composition';
function Probe() {
  const auth = useAuth();
  return <button onClick={auth.syncLoggedInFromStorage}>sync</button>;
}
function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProviderComposition>
        <Probe />
      </AuthProviderComposition>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mocks.exchange.mockReset();
  mocks.refetch.mockClear();
  window.history.replaceState({}, '', '/app');
});
afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
});
describe('document binding during login completion', () => {
  it('does not bind a replacement bearer in the dev-login sync callback', () => {
    localStorage.setItem('authorization', 'user-a');
    mount();
    localStorage.setItem('authorization', 'user-b');
    fireEvent.click(screen.getByText('sync'));
    expect(checkedDocumentCredentials()).toBeNull();
    expect(localStorage.getItem('authorization')).toBe('user-b');
  });
  it('does not bind a bearer replaced after the write lock returns', async () => {
    window.history.replaceState({}, '', '/app?authCode=abc');
    markLoginStarted();
    mocks.exchange.mockResolvedValue('login-a');
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, _opts: unknown, operation: () => unknown) => {
          const result = operation();
          localStorage.setItem('authorization', 'user-b');
          return Promise.resolve(result);
        },
      },
    });
    mount();
    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem('authorization')).toBe('user-b');
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(checkedDocumentCredentials()).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { useProfilePairRequest } from './useProfilePairRequest';

const state = vi.hoisted(() => ({
  user: { id: 'viewer' } as { id: string } | null,
  loading: false,
  loggedIn: true,
  mode: 'CLIENT' as 'CLIENT' | 'STYLIST' | null,
  account: {
    name: 'Anna',
    client_account: { account_id: 'client' },
    stylist_account: null,
  } as
    | {
        name: string;
        client_account: { account_id: string } | null;
        stylist_account: { account_id: string } | null;
      }
    | undefined,
  access: {
    isPaired: false,
    isPendingRequest: false,
    isChecked: true,
    isFetching: false,
    checkFailed: false,
  },
  push: vi.fn(),
  gate: vi.fn(),
  mutate: vi.fn(),
  intent: vi.fn(),
  accessHook: vi.fn(),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ asPath: '/stylist/anna/?from=qr', push: state.push }),
}));
vi.mock('../../../contexts/AuthContext.composition', () => ({
  useCurrentUser: () => ({ user: state.user, isLoading: state.loading }),
  useAuth: () => ({ accountType: state.mode, isLoggedIn: state.loggedIn }),
}));
vi.mock('../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: state.account }),
}));
vi.mock('../../../shared/hooks/useSessionRole', () => ({
  useIsClient: () => state.mode === 'CLIENT',
}));
vi.mock('../../shared/pairing/hooks/usePairingAccessStatus', () => ({
  usePairingAccessStatus: (id: string, enabled: boolean) => {
    state.accessHook(id, enabled);
    return state.access;
  },
}));
vi.mock('../../shared/pairing/hooks/usePairRequests', () => ({
  useRequestPair: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock('../../shared/pairing/usePairNameGate', () => ({
  usePairNameGate: () => ({ run: state.gate, dialog: null }),
}));
vi.mock('./useProfilePairIntent', () => ({
  useProfilePairIntent: (action: string) => state.intent(action),
}));

const profile = {
  account: { account_id: 'stylist', display_name: 'Anna', avatar_url: null },
} as Parameters<typeof useProfilePairRequest>[0];
const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider
    locale='pl'
    messages={{ labels: { stylistFallback: 'Stylistka' } }}>
    {children}
  </NextIntlClientProvider>
);

describe('profile request by audience', () => {
  beforeEach(() => {
    state.user = { id: 'viewer' };
    state.loading = false;
    state.loggedIn = true;
    state.mode = 'CLIENT';
    state.account = {
      name: 'Anna',
      client_account: { account_id: 'client' },
      stylist_account: null,
    };
    state.access = {
      isPaired: false,
      isPendingRequest: false,
      isChecked: true,
      isFetching: false,
      checkFailed: false,
    };
    state.push.mockReset();
    state.gate.mockReset();
    state.mutate.mockReset();
    state.intent.mockReset();
    state.accessHook.mockReset();
  });
  it('blocks self-request even in client mode and consumes the intent', () => {
    state.account = {
      name: 'Anna',
      client_account: { account_id: 'client' },
      stylist_account: { account_id: 'stylist' },
    };
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('owner');
    expect(state.accessHook).toHaveBeenCalledWith('stylist', false);
    expect(result.current.canRequestPair).toBe(false);
    result.current.request();
    expect(state.gate).not.toHaveBeenCalled();
    expect(state.mutate).not.toHaveBeenCalled();
    expect(state.intent).toHaveBeenCalledWith('consume');
  });
  it('takes another stylist without a client account through client setup and back to this profile', () => {
    state.mode = 'STYLIST';
    state.account = {
      name: 'Anna',
      client_account: null,
      stylist_account: { account_id: 'different' },
    };
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('stylistNoClient');
    result.current.request();
    expect(state.push).toHaveBeenCalledWith(
      '/app/onboarding?role=client&from=%2Fstylist%2Fanna%2F%3Ffrom%3Dqr%26pair%3D1'
    );
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it('uses the existing confirmation gate for a resolved public client, without sending immediately', () => {
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('clientPublic');
    result.current.request();
    expect(state.gate).toHaveBeenCalledOnce();
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it('keeps a conversation request intent until the user explicitly switches to client mode', () => {
    state.mode = 'STYLIST';
    state.account = {
      name: 'Anna',
      client_account: { account_id: 'client' },
      stylist_account: { account_id: 'different' },
    };
    const { result, rerender } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('stylistWithClient');
    expect(state.intent).toHaveBeenLastCalledWith('wait');
    expect(state.mutate).not.toHaveBeenCalled();
    state.mode = 'CLIENT';
    rerender();
    expect(result.current.audience).toBe('clientPublic');
    expect(state.intent).toHaveBeenLastCalledWith('request');
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it('waits for unknown mode and never treats it as guest or stylist', () => {
    state.mode = null;
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('checking');
    expect(state.intent).toHaveBeenCalledWith('wait');
    result.current.request();
    expect(state.push).not.toHaveBeenCalled();
    expect(state.gate).not.toHaveBeenCalled();
  });
  it('does not consume or act on intent after an access failure', () => {
    state.access.checkFailed = true;
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('accessFailed');
    expect(result.current.canRequestPair).toBe(false);
    expect(state.intent).toHaveBeenCalledWith('wait');
    result.current.request();
    expect(state.gate).not.toHaveBeenCalled();
  });
  it('takes a guest to login with the intended profile and explicit confirmation', () => {
    state.user = null;
    state.loggedIn = false;
    state.mode = null;
    state.account = undefined;
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('guest');
    result.current.request();
    expect(state.push).toHaveBeenCalledWith(
      '/user/login?from=%2Fstylist%2Fanna%2F%3Ffrom%3Dqr%26pair%3D1'
    );
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it('does not misidentify an unresolved stored session as a guest', () => {
    state.user = null;
    state.loggedIn = true;
    const { result } = renderHook(
      () => useProfilePairRequest(profile, vi.fn()),
      { wrapper }
    );
    expect(result.current.audience).toBe('checking');
    result.current.request();
    expect(state.push).not.toHaveBeenCalled();
  });
});

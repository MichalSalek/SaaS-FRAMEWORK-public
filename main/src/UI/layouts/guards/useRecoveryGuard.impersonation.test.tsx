import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';

const state = vi.hoisted(() => ({
  replace: vi.fn(),
  token: 'impersonation-token' as string | null,
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/app', replace: state.replace }),
}));
vi.mock('../../../application/routing/navigation.possibilities.api', () => ({
  runInstant: (_reason: string, navigate: () => void) => navigate(),
}));
vi.mock(
  '../../../application/client-device-storage/clientStorage.possibilities.api',
  () => ({
    getFromClientStorage: () => state.token,
  })
);
import { useRecoveryGuard } from './useRecoveryGuard';

describe('recovery guard during impersonation hydration', () => {
  const currentUser = {
    is_active: false,
    deleted_at: '2026-11-01T00:00:00Z',
    recovery_available: true,
  } as SafeCurrentUserWire;
  it('does not redirect before the impersonation flag has been read by the role hook', () => {
    renderHook(() =>
      useRecoveryGuard({
        currentUser,
        isLoading: false,
        isFetching: false,
        isAdmin: false,
        isBecomeUser: false,
      })
    );
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('still redirects the account owner to recovery', () => {
    state.token = null;
    renderHook(() =>
      useRecoveryGuard({
        currentUser,
        isLoading: false,
        isFetching: false,
        isAdmin: false,
        isBecomeUser: false,
      })
    );
    expect(state.replace).toHaveBeenCalledWith('/app/user/recover');
  });
});

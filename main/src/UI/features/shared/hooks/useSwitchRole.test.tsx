import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { AUTH_IDENTITY_WILL_CHANGE_EVENT } from '../../../../application/auth/auth-token-teardown';
import { useSwitchRole } from './useSwitchRole';

const mocks = vi.hoisted(() => ({
  switchRole: vi.fn(),
  refetch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../domain/user/userOnboardingIO.possibilities.api', () => ({
  switchRole_IO: mocks.switchRole,
}));
vi.mock('../../../../application/auth/better-auth-client', () => ({
  authClient: { useSession: () => ({ refetch: mocks.refetch }) },
}));
vi.mock('../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSwitchRole(), { wrapper });
}

describe('role switch identity boundary', () => {
  it('announces a successful switch and keeps the session refresh', async () => {
    mocks.switchRole.mockResolvedValueOnce({});
    const listener = vi.fn();
    window.addEventListener(AUTH_IDENTITY_WILL_CHANGE_EVENT, listener);
    const { result } = setup();
    await result.current.mutateAsync({ account_type: AccountTypeValue.CLIENT });
    expect(listener).toHaveBeenCalledOnce();
    expect(mocks.refetch).toHaveBeenCalled();
    window.removeEventListener(AUTH_IDENTITY_WILL_CHANGE_EVENT, listener);
  });

  it('does not announce an unsuccessful switch', async () => {
    mocks.switchRole.mockRejectedValueOnce(new Error('failed'));
    const listener = vi.fn();
    window.addEventListener(AUTH_IDENTITY_WILL_CHANGE_EVENT, listener);
    const { result } = setup();
    await expect(
      result.current.mutateAsync({ account_type: AccountTypeValue.CLIENT })
    ).rejects.toThrow('failed');
    await waitFor(() => expect(listener).not.toHaveBeenCalled());
    window.removeEventListener(AUTH_IDENTITY_WILL_CHANGE_EVENT, listener);
  });
});

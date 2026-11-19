import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../application/auth/better-auth-client', () => ({
  authClient: {
    getSession: vi.fn(async () => ({
      data: { user: { email: 'new@example.test' } },
    })),
  },
  signOut: vi.fn(),
}));
import { useLoginConfirmationGate } from './useLoginConfirmationGate';
afterEach(() => {
  Reflect.deleteProperty(navigator, 'locks');
  localStorage.clear();
  sessionStorage.clear();
});
describe('login confirmation under concurrent token writes', () => {
  it('keeps confirmation actionable if completing the accepted login fails', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error('session failure'))
      .mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useLoginConfirmationGate(complete));
    await act(async () => {
      await hook.result.current.holdForConfirmation('pending-a', false);
    });
    await act(async () => {
      hook.result.current.confirmFreshLogin();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.loginConfirmation?.status).toBe('pending');
    expect(hook.result.current.loginConfirmation?.retryRequired).toBe(true);
    await act(async () => {
      hook.result.current.confirmFreshLogin();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(hook.result.current.loginConfirmation).toBeNull();
  });
  it('keeps the pending token for a new decision when storage changes while waiting for the lock', async () => {
    localStorage.setItem('authorization', 'existing-b');
    const complete = vi.fn(async (_token: string) => {});
    const hook = renderHook(() => useLoginConfirmationGate(complete));
    await act(async () => {
      await hook.result.current.holdForConfirmation('pending-a', true);
    });
    let acquire!: () => void;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, _opts: unknown, operation: () => unknown) =>
          new Promise(resolve => {
            acquire = () => resolve(operation());
          }),
      },
    });
    act(() => hook.result.current.confirmFreshLogin());
    localStorage.setItem('authorization', 'newer-c');
    await act(async () => {
      acquire();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem('authorization')).toBe('newer-c');
    expect(complete).not.toHaveBeenCalled();
    expect(hook.result.current.loginConfirmation?.status).toBe('pending');
    expect(hook.result.current.loginConfirmation?.retryRequired).toBe(true);
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, _opts: unknown, operation: () => unknown) =>
          Promise.resolve(operation()),
      },
    });
    await act(async () => {
      hook.result.current.confirmFreshLogin();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem('authorization')).toBe('pending-a');
    expect(complete).toHaveBeenCalledWith('pending-a');
    expect(hook.result.current.loginConfirmation).toBeNull();
  });
});

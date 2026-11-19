import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindDocumentCredentials } from '../../application/auth/document-credentials';
import { useDocumentCredentialsGuard } from './useDocumentCredentialsGuard';
vi.mock('../../application/routing/leave-guard', () => ({
  bypassLeaveGuard: vi.fn(),
}));
const setup = (blocked = false) => {
  const reload = vi.fn(),
    clearIdentityState = vi.fn(),
    localLogoutTeardown = vi.fn(async () => {});
  const view = renderHook(
    ({ loginBlocked }) =>
      useDocumentCredentialsGuard({
        loginBlocked,
        reload,
        clearIdentityState,
        localLogoutTeardown,
      }),
    { initialProps: { loginBlocked: blocked } }
  );
  return { ...view, reload, clearIdentityState, localLogoutTeardown };
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('authorization', 'a');
  bindDocumentCredentials();
});
describe('cross-tab credential changes', () => {
  it('clears old in-memory state and reloads while preserving replacement token', () => {
    const view = setup();
    localStorage.setItem('authorization', 'b');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'authorization',
          oldValue: 'a',
          newValue: 'b',
        })
      );
    });
    expect(view.clearIdentityState).toHaveBeenCalledWith(false);
    expect(view.reload).toHaveBeenCalledOnce();
    expect(view.localLogoutTeardown).not.toHaveBeenCalled();
    expect(localStorage.getItem('authorization')).toBe('b');
  });
  it('uses the existing local logout path for a removal', () => {
    const view = setup();
    localStorage.removeItem('authorization');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'authorization',
          oldValue: 'a',
          newValue: null,
        })
      );
    });
    expect(view.localLogoutTeardown).toHaveBeenCalledWith(null);
    expect(view.reload).not.toHaveBeenCalled();
  });
  it('defers replacement during a held login, then reconciles it', () => {
    const view = setup(true);
    localStorage.setItem('authorization', 'b');
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'authorization', newValue: 'b' })
      );
    });
    expect(view.reload).not.toHaveBeenCalled();
    view.rerender({ loginBlocked: false });
    expect(view.reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem('authorization')).toBe('b');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLoggedOutEntryGuard } from './useLoggedOutEntryGuard';

const state = vi.hoisted(() => ({
  router: {
    pathname: '/app/gallery/upload-asset',
    replace: vi.fn(),
  },
}));

vi.mock('next/router', () => ({ useRouter: () => state.router }));
vi.mock('../../../application/routing/navigation.possibilities.api', () => ({
  runInstant: (_reason: string, navigate: () => unknown) => navigate(),
}));

describe('logged-out entry navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.router = {
      pathname: '/app/gallery/upload-asset',
      replace: vi.fn(),
    };
    window.history.replaceState(
      null,
      '',
      '/de/app/gallery/upload-asset/?nf_cta=primary'
    );
  });

  it('does not replace the original destination with a nested login on rerender', () => {
    const { rerender } = renderHook(() =>
      useLoggedOutEntryGuard({
        isLoggedIn: false,
        desktopAccess: 'normal',
      })
    );
    expect(state.router.replace).toHaveBeenCalledWith({
      pathname: '/user/login',
      query: { from: '/de/app/gallery/upload-asset/?nf_cta=primary' },
    });
    window.history.replaceState(
      null,
      '',
      '/de/user/login?from=%2Fde%2Fapp%2Fgallery%2Fupload-asset'
    );
    state.router = { ...state.router };
    rerender();
    expect(state.router.replace).toHaveBeenCalledTimes(1);
  });

  it('keeps the entry address when another redirect changes the URL before this guard fires', () => {
    const { rerender } = renderHook(
      ({ desktopAccess }: { desktopAccess: 'redirect' | 'normal' }) =>
        useLoggedOutEntryGuard({ isLoggedIn: false, desktopAccess }),
      { initialProps: { desktopAccess: 'redirect' } }
    );
    expect(state.router.replace).not.toHaveBeenCalled();
    window.history.replaceState(null, '', '/de/user/login?from=%2Fde%2Fapp');
    rerender({ desktopAccess: 'normal' });
    expect(state.router.replace).toHaveBeenCalledWith({
      pathname: '/user/login',
      query: { from: '/de/app/gallery/upload-asset/?nf_cta=primary' },
    });
  });
});

import { StrictMode, type PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRouter } from 'next/router';
import { NATIVE_BACK_EVENT } from '../../../application/platform/native-back';
import {
  beginPlanDecisionPush,
  finishPlanDecisionPush,
  interceptPlanDecisionPopState,
} from '../../../application/routing/plan-decision-navigation';
import {
  usePlanDecisionCleanup,
  usePlanDecisionNavigation,
} from './usePlanDecisionNavigation';

const state = vi.hoisted(() => ({ router: {} as NextRouter }));
vi.mock('next/router', () => ({ useRouter: () => state.router }));

function createRouter(initial: string) {
  window.history.replaceState({ route: initial }, '', initial);
  const entries = [initial];
  const router = {
    isReady: true,
    asPath: initial,
    push: vi.fn(async (url: string) => {
      await Promise.resolve();
      entries.push(url);
      window.history.pushState({ route: url }, '', url);
      router.asPath = url;
      return true;
    }),
    replace: vi.fn(async (url: string) => {
      await Promise.resolve();
      entries[entries.length - 1] = url;
      window.history.replaceState({ route: url }, '', url);
      router.asPath = url;
      return true;
    }),
    back: vi.fn(() => {
      const target = entries.at(-2);
      if (!target) {
        return;
      }
      window.history.replaceState({ route: target }, '', target);
      if (!interceptPlanDecisionPopState(target)) {
        entries.pop();
        router.asPath = target;
      }
    }),
  };
  state.router = router as unknown as NextRouter;
  return router;
}

beforeEach(() => createRouter('/pay?promo=SAVE#billing'));
afterEach(cleanup);

const strict = ({ children }: PropsWithChildren) => (
  <StrictMode>{children}</StrictMode>
);

describe('plan decision history hook', () => {
  it('allows closing after an earlier Back was refused by a new payment lock', async () => {
    const router = createRouter('/pay?promo=SAVE');
    const performBack = router.back;
    router.back = vi.fn();
    const onClose = vi.fn();
    const { result, rerender } = renderHook(
      ({ locked }) =>
        usePlanDecisionNavigation({ onClose, dismissLocked: locked }),
      { initialProps: { locked: false } }
    );
    await waitFor(() => expect(router.asPath).toContain('planDecision=1'));
    act(() => result.current());
    rerender({ locked: true });
    act(() => performBack());
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.search).toContain('planDecision=1');
    rerender({ locked: false });
    router.back = performBack;
    act(() => result.current());
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('does not replace an orphan flag while its history push is still settling', async () => {
    const router = createRouter('/pay?planDecision=1');
    const pending = beginPlanDecisionPush();
    try {
      renderHook(() => usePlanDecisionCleanup(state.router));
      await act(async () => {
        await Promise.resolve();
      });
      expect(router.replace).not.toHaveBeenCalled();
    } finally {
      finishPlanDecisionPush(pending);
    }
  });
  it('opens again after Back even if the router context still has the old flag', async () => {
    const router = createRouter('/pay?promo=SAVE');
    router.asPath = '/pay?promo=SAVE&planDecision=1';
    const { rerender } = renderHook(() =>
      usePlanDecisionNavigation({ onClose: vi.fn(), dismissLocked: false })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.push).not.toHaveBeenCalled();
    router.asPath = '/pay?promo=SAVE';
    rerender();
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
    expect(window.location.search).toContain('planDecision=1');
  });
  it('creates one shallow presentation entry under StrictMode', async () => {
    const router = createRouter('/pay?promo=SAVE#billing');
    const close = vi.fn();
    renderHook(
      () => usePlanDecisionNavigation({ onClose: close, dismissLocked: false }),
      { wrapper: strict }
    );
    await waitFor(() =>
      expect(router.asPath).toBe('/pay?promo=SAVE&planDecision=1#billing')
    );
    expect(router.push).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledWith(
      '/pay?promo=SAVE&planDecision=1#billing',
      undefined,
      { shallow: true, scroll: false }
    );
    expect(window.location.search).toContain('planDecision=1');
    expect(close).not.toHaveBeenCalled();
  });

  it('consumes native Back and closes the idle decision through history', async () => {
    const router = createRouter('/pay?promo=SAVE#billing');
    const close = vi.fn();
    renderHook(() =>
      usePlanDecisionNavigation({ onClose: close, dismissLocked: false })
    );
    await waitFor(() => expect(router.asPath).toContain('planDecision=1'));
    const back = new Event(NATIVE_BACK_EVENT, { cancelable: true });
    await act(async () => {
      window.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(router.asPath).toBe('/pay?promo=SAVE#billing');
    expect(window.location.hash).toBe('#billing');
    expect(close).toHaveBeenCalledOnce();
  });

  it('consumes native Back without closing or navigating while locked', async () => {
    const router = createRouter('/pay?promo=SAVE#billing');
    const close = vi.fn();
    renderHook(() =>
      usePlanDecisionNavigation({ onClose: close, dismissLocked: true })
    );
    await waitFor(() => expect(router.asPath).toContain('planDecision=1'));
    const back = new Event(NATIVE_BACK_EVENT, { cancelable: true });
    await act(async () => {
      window.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.asPath).toContain('planDecision=1');
    expect(close).not.toHaveBeenCalled();
  });

  it('removes a cold orphan flag without opening or creating a history entry', async () => {
    const router = createRouter('/pay?promo=SAVE&planDecision=1#billing');
    renderHook(() => usePlanDecisionCleanup(state.router), { wrapper: strict });
    await waitFor(() => expect(router.asPath).toBe('/pay?promo=SAVE#billing'));
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledOnce();
    expect(window.location.search).toBe('?promo=SAVE');
    expect(window.location.hash).toBe('#billing');
  });

  it('uses the latest onClose without creating another history entry', async () => {
    const router = createRouter('/pay?promo=SAVE#billing');
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(
      ({ onClose }) =>
        usePlanDecisionNavigation({ onClose, dismissLocked: false }),
      { initialProps: { onClose: first } }
    );
    await waitFor(() => expect(router.asPath).toContain('planDecision=1'));
    rerender({ onClose: latest });
    const back = new Event(NATIVE_BACK_EVENT, { cancelable: true });
    await act(async () => {
      window.dispatchEvent(back);
    });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledOnce();
    expect(router.push).toHaveBeenCalledOnce();
  });

  it('consumes only one history entry after a rapid double cancel', async () => {
    const router = createRouter('/pay?promo=SAVE');
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      usePlanDecisionNavigation({ onClose, dismissLocked: false })
    );
    await waitFor(() => expect(router.asPath).toContain('planDecision=1'));
    act(() => {
      result.current();
      result.current();
    });
    expect(router.back).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('dismisses an already flagged live view without leaving a stale flag', async () => {
    const router = createRouter('/pay?promo=SAVE&planDecision=1');
    const onClose = vi.fn();
    const { result } = renderHook(() =>
      usePlanDecisionNavigation({ onClose, dismissLocked: false })
    );
    await act(async () => {
      await Promise.resolve();
      result.current();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(router.asPath).toBe('/pay?promo=SAVE');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('undoes a presentation push that settles after the decision has closed', async () => {
    const router = createRouter('/pay?promo=SAVE');
    const push = router.push;
    let release = () => {};
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    router.push = vi.fn(async url => {
      await pending;
      return push(url);
    });
    const { unmount } = renderHook(() =>
      usePlanDecisionNavigation({ onClose: vi.fn(), dismissLocked: false })
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledOnce());
    unmount();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(router.back).toHaveBeenCalledOnce());
    expect(router.asPath).toBe('/pay?promo=SAVE');
  });
});

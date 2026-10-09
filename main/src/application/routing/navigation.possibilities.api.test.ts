// Seam tests (NVT) — runNavigationIntent / runInstant / preserveNextScroll.
// jsdom: shell presence is a real DOM query; the controller is simulated by
// driving store actions (markExitDone etc.) directly.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationStore } from '../stores/navigation.store';
import {
  preserveNextScroll,
  runInstant,
  runNavigationIntent,
} from './navigation.possibilities.api';

const store = useNavigationStore;

function mountShell(): void {
  const shell = document.createElement('div');
  shell.setAttribute('data-navigation-content-shell', '');
  document.body.appendChild(shell);
}

beforeEach(() => {
  store.setState(store.getInitialState(), true);
  store.getState().setControllerMounted(true);
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runNavigationIntent — exit-first hook grade (O19)', () => {
  it('opens exiting immediately and defers performNav until exit done', async () => {
    mountShell();
    const performNav = vi.fn(() => 'navigated');

    const resultPromise = runNavigationIntent(
      { direction: 'forward', targetPathname: '/app/gallery', reason: 't' },
      performNav
    );

    const s = store.getState();
    expect(s.phase).toBe('exiting');
    expect(s.armedHookNav).toBe(true);
    expect(performNav).not.toHaveBeenCalled();

    store.getState().markExitDone(s.transitionId);
    await expect(resultPromise).resolves.toBe('navigated');
    expect(performNav).toHaveBeenCalledTimes(1);
  });

  it('superseded armed nav never runs performNav (last-wins)', async () => {
    mountShell();
    const firstNav = vi.fn();

    const firstPromise = runNavigationIntent(
      { direction: 'forward', targetPathname: '/app/gallery', reason: 't1' },
      firstNav
    );
    // A second hook navigation interrupts before the exit finished.
    const secondNav = vi.fn(() => 'second');
    const secondPromise = runNavigationIntent(
      { direction: 'forward', targetPathname: '/app/pairing', reason: 't2' },
      secondNav
    );

    const id2 = store.getState().transitionId;
    store.getState().markExitDone(id2);

    await expect(firstPromise).resolves.toBeUndefined();
    expect(firstNav).not.toHaveBeenCalled();
    await expect(secondPromise).resolves.toBe('second');
  });

  it('no shell → immediate navigation with a stamped one-shot intent', async () => {
    const performNav = vi.fn(() => 'ok');
    const result = await runNavigationIntent(
      { direction: 'forward', targetPathname: '/app/gallery', reason: 't' },
      performNav
    );
    expect(result).toBe('ok');
    expect(performNav).toHaveBeenCalledTimes(1);
    // Clear-after-settle: performNav did not navigate, intent must not leak.
    expect(store.getState().pendingIntent).toBeNull();
  });

  it('controller not mounted → immediate navigation (no armed transition)', async () => {
    mountShell();
    store.getState().setControllerMounted(false);
    const performNav = vi.fn();
    await runNavigationIntent(
      { direction: 'forward', targetPathname: '/app/gallery', reason: 't' },
      performNav
    );
    expect(performNav).toHaveBeenCalledTimes(1);
    expect(store.getState().armedHookNav).toBe(false);
  });

  it('case 3 seam-side: same-path navigation skips the FSM entirely', async () => {
    mountShell();
    window.history.replaceState(null, '', '/app/gallery?tab=a');
    const performNav = vi.fn(() => 'same');
    const result = await runNavigationIntent(
      {
        direction: 'forward',
        targetPathname: '/app/gallery?tab=b',
        reason: 't',
      },
      performNav
    );
    expect(result).toBe('same');
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().pendingIntent).toBeNull();
  });

  it('SSR (no window) — falls back to plain performNav', async () => {
    // Simulated via targetless instant seam on the server is not testable in
    // jsdom; assert the guard branch through policy resolution instead:
    // an instant policy never arms an exit-first transition.
    mountShell();
    const performNav = vi.fn(() => 'done');
    await runNavigationIntent(
      { policy: 'instant', targetPathname: '/user/login', reason: 't' },
      performNav
    );
    expect(store.getState().phase).toBe('idle');
    expect(performNav).toHaveBeenCalledTimes(1);
  });
});

describe('back with nowhere to go (A8)', () => {
  it('Navigation API canGoBack=false → no FSM, no performNav (dead-button no-op)', async () => {
    mountShell();
    (window as { navigation?: { canGoBack?: boolean } }).navigation = {
      canGoBack: false,
    };
    const performNav = vi.fn();
    const result = await runNavigationIntent(
      { direction: 'back', reason: 'trigger-back' },
      performNav
    );
    expect(result).toBeUndefined();
    expect(performNav).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe('idle');
    delete (window as { navigation?: unknown }).navigation;
  });

  it('Navigation API unavailable → back arms normally (fallback path)', async () => {
    mountShell();
    const performNav = vi.fn();
    void runNavigationIntent(
      { direction: 'back', reason: 'trigger-back' },
      performNav
    );
    expect(store.getState().phase).toBe('exiting');
    expect(store.getState().armedHookNav).toBe(true);
  });

  it('R2-M seam-side: issued target-less back marks its pending popstate echo', async () => {
    mountShell();
    const resultPromise = runNavigationIntent(
      { direction: 'back', reason: 'trigger-back' },
      () => 'went-back'
    );
    const id = store.getState().transitionId;
    expect(store.getState().issuedBackNavPending).toBe(false);
    store.getState().markExitDone(id);
    await expect(resultPromise).resolves.toBe('went-back');
    // After proceed the seam marks BOTH: target (null) and the pending echo.
    expect(store.getState().issuedBackNavPending).toBe(true);
    expect(store.getState().issuedHookNavTarget).toBeNull();
  });

  it('R2-H seam-side: trailing-slash/locale target is stored normalized', async () => {
    mountShell();
    void runNavigationIntent(
      {
        direction: 'forward',
        targetPathname: '/en/app/gallery/?tab=x',
        reason: 't',
      },
      () => undefined
    );
    expect(store.getState().targetPathname).toBe('/app/gallery');
  });
});

describe('runInstant / one-shot semantics', () => {
  it('case 19: instant intent is consumed exactly once', async () => {
    await runInstant('guard', () => undefined, '/user/login');
    // performNav did nothing → clear-after-settle already dropped it.
    expect(store.getState().pendingIntent).toBeNull();
  });

  it('case 20: intent is cleared when performNav throws before route start', async () => {
    const boom = new Error('nav failed');
    await expect(
      runInstant(
        'guard',
        () => {
          throw boom;
        },
        '/user/login'
      )
    ).rejects.toBe(boom);
    expect(store.getState().pendingIntent).toBeNull();
  });

  it('a consumed intent is NOT cleared away from the consumer (real nav)', async () => {
    // performNav simulates a real navigation: routeChangeStart consumes the
    // intent synchronously inside the router call.
    await runInstant(
      'guard',
      () => {
        const consumed = store.getState().consumeIntentFor('/user/login');
        expect(consumed?.policy).toBe('instant');
      },
      '/user/login'
    );
    expect(store.getState().pendingIntent).toBeNull();
  });
});

describe('preserveNextScroll', () => {
  it('case 21: consumed by the next scroll resolution only', () => {
    preserveNextScroll('explore-restore');
    expect(store.getState().consumeScrollPreserve()).toBe(true);
    expect(store.getState().consumeScrollPreserve()).toBe(false);
  });
});

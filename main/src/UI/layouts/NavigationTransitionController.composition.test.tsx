// Controller wiring tests (NVT) — PLAN_NAVIGATION_TRANSITIONS §Vitest FSM
// cases, controller-level slice: router-event wiring, policy/direction/scroll
// resolution, html[data-nav-*] mirror, aria-busy, scroll reset and focus.
// Store-level FSM cases live in navigation.store.test.ts — NOT duplicated
// here.
//
// Strategy: vi.mock('next/router') with a controlled mini-emitter; render the
// REAL controller; drive it by emitting routeChangeStart/Complete/Error and
// by invoking the captured beforePopState callback. Assertions target store
// state, html[data-nav-*] attributes and ARIA — never DOM structure.
//
// Fake timers in EVERY test: the controller schedules 600ms exit/enter cap
// timeouts on each transition; keeping the clock fake prevents a stray real
// timeout from one test firing mid-way through a later one (vi.useRealTimers
// discards pending fake timers).

import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useNavigationStore } from '../../application/stores/navigation.store';
import { STORAGE_KEYS } from '../../application/client-device-storage/storage-keys.config';

const routerMock = vi.hoisted(() => {
  type RouterEventHandler = (...args: unknown[]) => void;
  const handlers = new Map<string, Set<RouterEventHandler>>();
  let popStateCallback: (() => boolean) | null = null;

  const events = {
    on: vi.fn((event: string, handler: RouterEventHandler): void => {
      const set = handlers.get(event) ?? new Set<RouterEventHandler>();
      set.add(handler);
      handlers.set(event, set);
    }),
    off: vi.fn((event: string, handler: RouterEventHandler): void => {
      handlers.get(event)?.delete(handler);
    }),
    emit: (event: string, ...args: unknown[]): void => {
      handlers.get(event)?.forEach(handler => handler(...args));
    },
  };

  const router = {
    events,
    beforePopState: vi.fn((fn: () => boolean): void => {
      popStateCallback = fn;
    }),
    back: vi.fn(),
    push: vi.fn(),
    pathname: '/',
    asPath: '/',
    locale: 'pl',
  };

  return {
    router,
    emit: events.emit,
    getPopStateCallback: (): (() => boolean) | null => popStateCallback,
    reset: (): void => {
      handlers.clear();
      popStateCallback = null;
    },
  };
});

vi.mock('next/router', () => ({
  useRouter: () => routerMock.router,
}));

import { NavigationTransitionControllerComposition } from './NavigationTransitionController.composition';

const store = useNavigationStore;

/** Must match NAV_EXIT_CAP_MS / NAV_ENTER_CAP_MS in the controller. */
const NAV_CAP_MS = 600;

function mountController(): ReturnType<typeof render> {
  return render(<NavigationTransitionControllerComposition />);
}

function addShell(): void {
  const shell = document.createElement('div');
  shell.setAttribute('data-navigation-content-shell', '');
  document.body.appendChild(shell);
}

function addMain(): HTMLElement {
  const main = document.createElement('main');
  main.id = 'main-content';
  document.body.appendChild(main);
  return main;
}

function emitStart(url: string, shallow = false): void {
  routerMock.emit('routeChangeStart', url, { shallow });
}

function emitComplete(url: string): void {
  routerMock.emit('routeChangeComplete', url, { shallow: false });
}

function emitError(url: string): void {
  routerMock.emit('routeChangeError', new Error('route change failed'), url);
}

beforeEach(() => {
  vi.useFakeTimers();
  routerMock.reset();
  store.setState(store.getInitialState(), true);
  document.body.innerHTML = '';
  delete document.documentElement.dataset['navPhase'];
  delete document.documentElement.dataset['navPolicy'];
  delete document.documentElement.dataset['navDirection'];
  window.history.replaceState(null, '', '/');
  sessionStorage.clear();
  // jsdom's window.scrollTo logs "Not implemented" — silence AND capture.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NVT controller — router-event wiring', () => {
  it('case 5: shallow start → instant, scroll preserved, focus skipped', () => {
    mountController();
    emitStart('/app/admin/x?f=1', true);

    const s = store.getState();
    expect(s.phase).toBe('instant');
    expect(s.policy).toBe('instant');
    expect(s.scrollMode).toBe('preserve');
    expect(s.skipFocus).toBe(true);
    expect(s.targetPathname).toBe('/app/admin/x');
  });

  it('case 3: same-path start (query-only) never enters the FSM', () => {
    // A1: the check compares against the router's PREVIOUS route (asPath) —
    // window.location is already updated when a popstate start arrives.
    routerMock.router.asPath = '/app/gallery?x=1';
    mountController();
    emitStart('/app/gallery?x=2');

    expect(store.getState().phase).toBe('idle');
    expect(store.getState().transitionId).toBe(0);
    routerMock.router.asPath = '/';
  });

  it('A1: popstate start to a DIFFERENT path enters the FSM with back direction', () => {
    // popstate semantics: window.location is ALREADY the target, while the
    // router still holds the previous route — the FSM must not same-path-skip.
    addShell();
    routerMock.router.asPath = '/app/pairing';
    window.history.replaceState(null, '', '/app/gallery');
    mountController();

    const beforePopState = routerMock.getPopStateCallback();
    expect(beforePopState).not.toBeNull();
    beforePopState?.();
    emitStart('/app/gallery');

    const s = store.getState();
    expect(s.phase).toBe('exiting');
    expect(s.direction).toBe('back');
    expect(s.popstatePending).toBe(false);
    routerMock.router.asPath = '/';
  });

  it('A1: popstate start skipped as same-path clears the leaked back intent', () => {
    routerMock.router.asPath = '/app/gallery?p=1';
    mountController();

    routerMock.getPopStateCallback()?.();
    emitStart('/app/gallery?p=2');

    expect(store.getState().phase).toBe('idle');
    expect(store.getState().pendingIntent).toBeNull();
    expect(store.getState().popstatePending).toBe(false);
    routerMock.router.asPath = '/';
  });

  it('A2: armed target-less back adopts ONLY a popstate-origin start', () => {
    addShell();
    mountController();
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'back',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: null,
      hookDriven: true,
    });

    // Interloper: a system redirect start (NOT popstate) with its own intent.
    store.getState().stampIntent({
      policy: 'instant',
      reason: 'guard',
      targetPathname: '/user/recover',
    });
    emitStart('/user/recover');

    const s = store.getState();
    // Armed nav cancelled (guard wins), the redirect's intent consumed → the
    // redirect runs as its own INSTANT transition, not an adopted slide.
    expect(s.armedHookNav).toBe(false);
    expect(s.phase).toBe('instant');
    expect(s.policy).toBe('instant');
    expect(s.pendingIntent).toBeNull();
  });

  it('A2: armed back adopts the start when it IS popstate-origin', () => {
    addShell();
    routerMock.router.asPath = '/app/pairing';
    mountController();
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'back',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: null,
      hookDriven: true,
    });

    routerMock.getPopStateCallback()?.();
    emitStart('/app/gallery');

    const s = store.getState();
    expect(s.armedHookNav).toBe(false);
    expect(s.phase).toBe('exiting');
    expect(s.direction).toBe('back');
    expect(s.targetPathname).toBe('/app/gallery');
    routerMock.router.asPath = '/';
  });

  it('A-race: stale start-echo of a superseded hook nav does not cancel the newer armed one', () => {
    addShell();
    mountController();
    // Newer armed nav to B; the echo of the earlier, superseded nav to A.
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'forward',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: '/app/b',
      hookDriven: true,
    });
    store.getState().setIssuedHookNavTarget('/app/a');

    emitStart('/app/a');

    const s = store.getState();
    expect(s.armedHookNav).toBe(true);
    expect(s.targetPathname).toBe('/app/b');
    expect(s.phase).toBe('exiting');
  });

  it('A5: shallow start neither adopts nor cancels an armed transition', () => {
    addShell();
    mountController();
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'forward',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: '/app/b',
      hookDriven: true,
    });
    const id = store.getState().transitionId;

    emitStart('/app/admin/ai-crawlers?f=2', true);

    const s = store.getState();
    expect(s.armedHookNav).toBe(true);
    expect(s.transitionId).toBe(id);
    expect(s.phase).toBe('exiting');
  });

  it('A7: a foreign routeChangeComplete does not promote the active transition', () => {
    addShell();
    const main = addMain();
    main.scrollTop = 500;
    mountController();
    emitStart('/app/gallery');
    expect(store.getState().phase).toBe('exiting');

    // Complete of a DIFFERENT navigation (same-path-skipped query sync).
    emitComplete('/app/other');

    const s = store.getState();
    expect(s.routeReady).toBe(false);
    expect(main.scrollTop).toBe(500);

    // The real complete still promotes.
    emitComplete('/app/gallery');
    expect(store.getState().routeReady).toBe(true);
    expect(main.scrollTop).toBe(0);
  });

  it('A4: adopted popstate-back to Explore re-resolves scroll to preserve', () => {
    addShell();
    routerMock.router.asPath = '/app/photo/123';
    sessionStorage.setItem(STORAGE_KEYS.EXPLORE_SCROLL_POSITION, '480');
    mountController();
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'back',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: null,
      hookDriven: true,
    });

    routerMock.getPopStateCallback()?.();
    emitStart('/app/explore');

    expect(store.getState().scrollMode).toBe('preserve');
    routerMock.router.asPath = '/';
  });

  it('R2-M: popstate echo of OUR OWN superseded back() does not cancel a newer armed nav', () => {
    addShell();
    routerMock.router.asPath = '/app/detail';
    mountController();
    // back() was issued (its popstate is pending)…
    store.getState().setIssuedBackNavPending(true);
    // …and the user tapped a tab in the meantime (newer armed nav).
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'forward',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: '/app/gallery',
      hookDriven: true,
    });

    routerMock.getPopStateCallback()?.();
    emitStart('/app/previous');

    const s = store.getState();
    expect(s.armedHookNav).toBe(true);
    expect(s.targetPathname).toBe('/app/gallery');
    expect(s.issuedBackNavPending).toBe(false);
    routerMock.router.asPath = '/';
  });

  it('R2-H: trailing-slash start url still matches a slash-less armed target', () => {
    addShell();
    mountController();
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'forward',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: '/app/gallery',
      hookDriven: true,
    });

    emitStart('/en/app/gallery/?tab=x');

    const s = store.getState();
    expect(s.armedHookNav).toBe(false);
    expect(s.targetPathname).toBe('/app/gallery');
    expect(s.phase).toBe('exiting');
  });

  it('A8: armed-nav watchdog resets a back() that never produced a route change', () => {
    addShell();
    mountController();
    store.getState().beginTransition({
      policy: 'slide',
      direction: 'back',
      scrollMode: 'reset',
      scrollModeExplicit: false,
      skipFocus: false,
      targetPathname: null,
      hookDriven: true,
    });
    const id = store.getState().transitionId;
    // Exit finishes; the armed nav is issued but no start ever arrives.
    store.getState().markExitDone(id);
    expect(store.getState().phase).toBe('waitingForRoute');

    vi.advanceTimersByTime(400);

    const s = store.getState();
    expect(s.phase).toBe('idle');
    expect(s.armedHookNav).toBe(false);
    expect(document.documentElement.dataset['navPhase']).toBeUndefined();
  });

  it('N1: shallow popstate start clears the leaked back intent', () => {
    mountController();
    routerMock.getPopStateCallback()?.();
    expect(store.getState().pendingIntent?.reason).toBe('popstate');

    emitStart('/app/admin/x?f=1', true);

    expect(store.getState().pendingIntent).toBeNull();
    expect(store.getState().popstatePending).toBe(false);
  });

  it('hashChangeStart clears popstate remnants; FSM untouched (A11)', () => {
    mountController();
    routerMock.emit('hashChangeStart', '/app/gallery#details', {
      shallow: false,
    });

    expect(store.getState().phase).toBe('idle');
    expect(store.getState().transitionId).toBe(0);
  });

  it('case 25: no shell in DOM → slide-target downgraded to instant', () => {
    mountController();
    emitStart('/app/gallery');

    expect(store.getState().phase).toBe('instant');
    expect(store.getState().policy).toBe('instant');
    // Instant never mirrors motion attributes into the DOM.
    expect(document.documentElement.dataset['navPhase']).toBeUndefined();
  });

  it('case 16: slide start with shell → exiting mirrored into html + aria-busy', () => {
    addShell();
    const main = addMain();
    mountController();
    emitStart('/app/gallery');

    const s = store.getState();
    expect(s.phase).toBe('exiting');
    expect(s.policy).toBe('slide');
    expect(s.direction).toBe('forward');

    const html = document.documentElement;
    expect(html.dataset['navPhase']).toBe('exiting');
    expect(html.dataset['navPolicy']).toBe('slide');
    expect(html.dataset['navDirection']).toBe('forward');
    expect(main.getAttribute('aria-busy')).toBe('true');
  });

  it('case 17: beforePopState callback stamps back direction for next start', () => {
    addShell();
    mountController();

    const popstate = routerMock.getPopStateCallback();
    expect(popstate).not.toBeNull();
    expect(popstate?.()).toBe(true);

    emitStart('/app/gallery');
    expect(store.getState().direction).toBe('back');
    expect(store.getState().phase).toBe('exiting');
  });
});

describe('NVT controller — caps, scroll & focus', () => {
  it('case 10/11: 600ms caps promote exiting → waitingForRoute → entering → idle', () => {
    addShell();
    const main = addMain();
    mountController();

    emitStart('/app/gallery');
    expect(store.getState().phase).toBe('exiting');

    vi.advanceTimersByTime(NAV_CAP_MS); // exit cap
    expect(store.getState().phase).toBe('waitingForRoute');

    emitComplete('/app/gallery');
    expect(store.getState().phase).toBe('entering');

    vi.advanceTimersByTime(NAV_CAP_MS); // enter cap
    expect(store.getState().phase).toBe('idle');

    // Settled: motion attributes and aria-busy are gone.
    expect(document.documentElement.dataset['navPhase']).toBeUndefined();
    expect(document.documentElement.dataset['navPolicy']).toBeUndefined();
    expect(document.documentElement.dataset['navDirection']).toBeUndefined();
    expect(main.hasAttribute('aria-busy')).toBe(false);
  });

  it('case 23: scroll reset (main + window) happens BEFORE entering', () => {
    addShell();
    const main = addMain();
    mountController();

    emitStart('/app/gallery');
    vi.advanceTimersByTime(NAV_CAP_MS); // exitDone → waitingForRoute
    main.scrollTop = 500;
    expect(main.scrollTop).toBe(500);

    // Capture BOTH scroll-owner resets at the exact moment the FSM enters.
    // The window call must explicitly use behavior:'auto' to override the
    // project-wide smooth-scroll CSS; checking only the final position would
    // miss a regression where the old page remains visible while scrolling.
    let scrollTopAtEntering: number | null = null;
    let windowResetCalledAtEntering = false;
    const unsubscribe = store.subscribe((state, prev) => {
      if (state.phase === 'entering' && prev.phase !== 'entering') {
        scrollTopAtEntering = main.scrollTop;
        windowResetCalledAtEntering =
          vi.mocked(window.scrollTo).mock.calls.length > 0;
      }
    });
    emitComplete('/app/gallery');
    unsubscribe();

    expect(main.scrollTop).toBe(0);
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'auto',
    });
    expect(scrollTopAtEntering).toBe(0);
    expect(windowResetCalledAtEntering).toBe(true);
    expect(store.getState().phase).toBe('entering');
  });

  it('case 22: saved Explore list position → scrollMode preserve on Explore target', () => {
    addShell();
    mountController();
    sessionStorage.setItem(STORAGE_KEYS.EXPLORE_SCROLL_POSITION, '480');

    emitStart(ROUTES_FRONT.EXPLORE);
    expect(store.getState().scrollMode).toBe('preserve');
    expect(store.getState().phase).toBe('exiting');
  });

  it('case 24: focus lands on #main-content only after the transition settles', () => {
    addShell();
    const main = addMain();
    mountController();

    emitStart('/app/gallery');
    expect(document.activeElement).not.toBe(main);

    vi.advanceTimersByTime(NAV_CAP_MS);
    emitComplete('/app/gallery');
    // Still entering — focus is deferred until idle.
    expect(document.activeElement).not.toBe(main);

    vi.advanceTimersByTime(NAV_CAP_MS);
    expect(store.getState().phase).toBe('idle');
    expect(main.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(main);
  });
});

describe('NVT controller — errors & lifecycle', () => {
  it('routeChangeError of the active target resets to idle and clears DOM attrs', () => {
    addShell();
    mountController();

    emitStart('/app/gallery');
    expect(store.getState().phase).toBe('exiting');

    emitError('/app/gallery');
    expect(store.getState().phase).toBe('idle');
    expect(document.documentElement.dataset['navPhase']).toBeUndefined();
  });

  it('stale routeChangeError (superseded start, other url) is ignored', () => {
    addShell();
    mountController();

    emitStart('/app/gallery');
    emitStart('/app/pairing'); // supersedes — last wins

    emitError('/app/gallery'); // stale error carries the OLD target
    expect(store.getState().phase).toBe('exiting');
    expect(store.getState().targetPathname).toBe('/app/pairing');
  });

  it('case 26: StrictMode double-mount keeps exactly one live wiring; unmount detaches', () => {
    addShell();
    const view = render(
      <StrictMode>
        <NavigationTransitionControllerComposition />
      </StrictMode>
    );
    expect(store.getState().controllerMounted).toBe(true);

    // Full transition passes through the FSM despite the strict re-mount.
    emitStart('/app/gallery');
    expect(store.getState().phase).toBe('exiting');
    vi.advanceTimersByTime(NAV_CAP_MS);
    emitComplete('/app/gallery');
    vi.advanceTimersByTime(NAV_CAP_MS);
    expect(store.getState().phase).toBe('idle');
    const settledId = store.getState().transitionId;

    view.unmount();
    expect(store.getState().controllerMounted).toBe(false);
    expect(store.getState().triggerBack).toBeNull();

    // Events are detached — an emit after unmount never reaches the store.
    emitStart('/app/pairing');
    emitComplete('/app/pairing');
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().transitionId).toBe(settledId);
  });
});

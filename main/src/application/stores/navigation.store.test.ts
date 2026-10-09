// FSM contract tests (NVT) — PLAN_NAVIGATION_TRANSITIONS §Vitest FSM cases.
// Pure store-level: router events / animationend arrive as store actions here;
// controller wiring is covered in NavigationTransitionController tests.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  useNavigationStore,
  type BeginTransitionConfig,
} from './navigation.store';

const store = useNavigationStore;

function begin(overrides: Partial<BeginTransitionConfig> = {}): number {
  return store.getState().beginTransition({
    policy: 'slide',
    direction: 'forward',
    scrollMode: 'reset',
    scrollModeExplicit: false,
    skipFocus: false,
    targetPathname: '/app/gallery',
    hookDriven: false,
    ...overrides,
  });
}

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

describe('navigation FSM — phases', () => {
  it('case 1: idle → exiting on slide start', () => {
    begin();
    expect(store.getState().phase).toBe('exiting');
  });

  it('case 2: idle → instant on instant policy', () => {
    begin({ policy: 'instant' });
    expect(store.getState().phase).toBe('instant');
  });

  it('case 6: exiting waits for route — exit done first → waitingForRoute', () => {
    const id = begin();
    store.getState().markExitDone(id);
    expect(store.getState().phase).toBe('waitingForRoute');
  });

  it('case 7: route ready first → stays exiting until exit done', () => {
    const id = begin();
    store.getState().markRouteReady(id);
    expect(store.getState().phase).toBe('exiting');
    expect(store.getState().routeReady).toBe(true);
  });

  it('case 8: exitDone + routeReady → entering (both orders)', () => {
    let id = begin();
    store.getState().markExitDone(id);
    store.getState().markRouteReady(id);
    expect(store.getState().phase).toBe('entering');

    store.setState(store.getInitialState(), true);
    id = begin();
    store.getState().markRouteReady(id);
    store.getState().markExitDone(id);
    expect(store.getState().phase).toBe('entering');
  });

  it('case 9: entering animationend → idle', () => {
    const id = begin();
    store.getState().markExitDone(id);
    store.getState().markRouteReady(id);
    store.getState().markEnterDone(id);
    expect(store.getState().phase).toBe('idle');
  });

  it('instant + route complete → idle', () => {
    const id = begin({ policy: 'instant' });
    store.getState().markRouteReady(id);
    expect(store.getState().phase).toBe('idle');
  });

  it('case 12: routeChangeError of the active transition → idle', () => {
    begin({ targetPathname: '/app/gallery' });
    store.getState().failTransition('/app/gallery');
    expect(store.getState().phase).toBe('idle');
    // A failed transition never steals focus.
    expect(store.getState().skipFocus).toBe(true);
  });

  it('case 13: stale routeChangeError (superseded target) is ignored', () => {
    begin({ targetPathname: '/app/gallery' });
    // Old, superseded navigation errors out with ITS url — not ours.
    store.getState().failTransition('/app/pairing');
    expect(store.getState().phase).toBe('exiting');
  });

  it('target-less error (back navigation) resets the active transition', () => {
    begin({ targetPathname: null });
    store.getState().failTransition('/app/anything');
    expect(store.getState().phase).toBe('idle');
  });

  it('case 14: superseded nav increments id and cancels old callbacks', () => {
    const first = begin();
    const second = begin({ targetPathname: '/app/pairing' });
    expect(second).toBeGreaterThan(first);
    // Stale callbacks from the first transition are no-ops now.
    store.getState().markExitDone(first);
    expect(store.getState().phase).toBe('exiting');
    expect(store.getState().exitDone).toBe(false);
    store.getState().markEnterDone(first);
    expect(store.getState().phase).toBe('exiting');
  });

  it('case 15: rapid 3 starts — final transition still completes to idle', () => {
    begin({ targetPathname: '/app/a' });
    begin({ targetPathname: '/app/b' });
    const id3 = begin({ targetPathname: '/app/c' });
    store.getState().markExitDone(id3);
    store.getState().markRouteReady(id3);
    store.getState().markEnterDone(id3);
    expect(store.getState().phase).toBe('idle');
  });

  it('duplicate markExitDone is idempotent', () => {
    const id = begin();
    store.getState().markExitDone(id);
    store.getState().markExitDone(id);
    expect(store.getState().phase).toBe('waitingForRoute');
  });
});

describe('navigation FSM — direction & intents', () => {
  it('case 16: direction defaults to forward on begin', () => {
    begin({ direction: 'forward' });
    expect(store.getState().direction).toBe('forward');
  });

  it('case 17/18: popstate stamps back-direction intent (unknown = back)', () => {
    store.getState().notePopstate();
    expect(store.getState().popstatePending).toBe(true);
    const intent = store.getState().consumeIntentFor('/anything');
    expect(intent?.direction).toBe('back');
  });

  it('popstate net does not override an armed hook transition', () => {
    begin({ hookDriven: true, direction: 'back', targetPathname: null });
    store.getState().notePopstate();
    expect(store.getState().pendingIntent).toBeNull();
    expect(store.getState().popstatePending).toBe(true);
  });

  it('popstate net does not clobber an explicit pending intent', () => {
    store.getState().stampIntent({
      policy: 'fade',
      reason: 'locale-switch',
      targetPathname: '/about',
    });
    store.getState().notePopstate();
    expect(store.getState().pendingIntent?.reason).toBe('locale-switch');
  });

  it('A11: clearPopstateRemnants drops the flag and the popstate intent only', () => {
    store.getState().notePopstate();
    store.getState().clearPopstateRemnants();
    expect(store.getState().popstatePending).toBe(false);
    expect(store.getState().pendingIntent).toBeNull();

    // A non-popstate intent survives the cleanup.
    store.getState().stampIntent({
      policy: 'instant',
      reason: 'redirect',
      targetPathname: '/user/login',
    });
    store.getState().notePopstate();
    store.getState().clearPopstateRemnants();
    expect(store.getState().pendingIntent?.reason).toBe('redirect');
  });

  it('A9: TTL expires only target-less intents', () => {
    const stamped = store.getState().stampIntent({
      policy: 'instant',
      reason: 'redirect',
      targetPathname: '/user/login',
    });
    // Backdate far beyond the TTL — target-bound must still be consumable.
    store.setState({
      pendingIntent: { ...stamped, stampedAt: stamped.stampedAt - 60_000 },
    });
    expect(store.getState().consumeIntentFor('/user/login')?.policy).toBe(
      'instant'
    );

    const targetless = store.getState().stampIntent({
      direction: 'back',
      reason: 'popstate',
      targetPathname: null,
    });
    store.setState({
      pendingIntent: {
        ...targetless,
        stampedAt: targetless.stampedAt - 60_000,
      },
    });
    expect(store.getState().consumeIntentFor('/anything')).toBeNull();
  });

  it('O20: intent for target A is not consumed by intervening B', () => {
    store.getState().stampIntent({
      policy: 'instant',
      reason: 'redirect',
      targetPathname: '/user/login',
    });
    expect(store.getState().consumeIntentFor('/app/gallery')).toBeNull();
    expect(store.getState().consumeIntentFor('/user/login')?.policy).toBe(
      'instant'
    );
    // …and it was one-shot (case 19 semantics at the store level).
    expect(store.getState().consumeIntentFor('/user/login')).toBeNull();
  });

  it('case 21: preserveNextScroll is consumed once', () => {
    store.getState().preserveNextScroll();
    expect(store.getState().consumeScrollPreserve()).toBe(true);
    expect(store.getState().consumeScrollPreserve()).toBe(false);
  });
});

describe('navigation FSM — armed hook transitions (O19)', () => {
  it('adoption clears the armed flag and records the target', () => {
    begin({ hookDriven: true, targetPathname: '/app/pairing' });
    expect(store.getState().armedHookNav).toBe(true);
    store.getState().adoptRouteStart('/app/pairing');
    expect(store.getState().armedHookNav).toBe(false);
    expect(store.getState().targetPathname).toBe('/app/pairing');
    expect(store.getState().phase).toBe('exiting');
  });

  it('A4: adoption re-resolves the scroll mode for the fresh target', () => {
    begin({ hookDriven: true, targetPathname: null, scrollMode: 'reset' });
    store.getState().adoptRouteStart('/app/explore', 'preserve');
    expect(store.getState().scrollMode).toBe('preserve');

    store.setState(store.getInitialState(), true);
    begin({
      hookDriven: true,
      targetPathname: null,
      scrollMode: 'preserve',
      scrollModeExplicit: true,
    });
    // Explicit intent scroll — adoption passes nothing, mode survives.
    store.getState().adoptRouteStart('/app/explore');
    expect(store.getState().scrollMode).toBe('preserve');
  });

  it('cancelArmedHookNav resets to idle and supersedes the waiter id', () => {
    const id = begin({ hookDriven: true, targetPathname: '/app/pairing' });
    store.getState().setIssuedBackNavPending(true);
    store.getState().cancelArmedHookNav();
    const s = store.getState();
    expect(s.phase).toBe('idle');
    expect(s.armedHookNav).toBe(false);
    expect(s.transitionId).toBeGreaterThan(id);
    // R3-F1: no issued-back marker may survive the cancel.
    expect(s.issuedBackNavPending).toBe(false);
  });

  it('N2/R3-F1: settle retires both issued-nav markers', () => {
    let id = begin();
    store.getState().setIssuedHookNavTarget('/app/gallery');
    store.getState().setIssuedBackNavPending(true);
    store.getState().markExitDone(id);
    store.getState().markRouteReady(id);
    store.getState().markEnterDone(id);
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().issuedHookNavTarget).toBeNull();
    expect(store.getState().issuedBackNavPending).toBe(false);

    store.setState(store.getInitialState(), true);
    id = begin({ policy: 'instant' });
    store.getState().setIssuedHookNavTarget('/app/gallery');
    store.getState().setIssuedBackNavPending(true);
    store.getState().markRouteReady(id);
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().issuedHookNavTarget).toBeNull();
    expect(store.getState().issuedBackNavPending).toBe(false);
  });

  it('R3-F1 nano: adoption retires a pre-armed popstate intent', () => {
    store.getState().notePopstate();
    expect(store.getState().pendingIntent?.reason).toBe('popstate');
    begin({ hookDriven: true, targetPathname: null });
    store.getState().adoptRouteStart('/app/gallery');
    expect(store.getState().pendingIntent).toBeNull();
  });

  it('A6: routeChangeError never kills an ARMED transition, even same-target', () => {
    begin({ hookDriven: true, targetPathname: '/app/pairing' });
    // Cancellation of an OLD nav to the SAME pathname (Next emits it from
    // change() of OUR push) must not reset the armed transition.
    store.getState().failTransition('/app/pairing');
    expect(store.getState().phase).toBe('exiting');
    expect(store.getState().armedHookNav).toBe(true);
    // The explicit watchdog reset (null) still works.
    store.getState().failTransition(null);
    expect(store.getState().phase).toBe('idle');
  });
});

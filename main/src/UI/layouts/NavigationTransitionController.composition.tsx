// Render-null controller — the ONLY subscriber of Next pages-router
// navigation events (`routeChangeStart/Complete/Error`, `beforePopState`)
// and the ONLY writer of the `html[data-nav-*]` attributes. Mounted once in
// `_app`. Replaces the old `NativeBackBridge` (View Transitions) entirely.
//
// Responsibilities:
//   1. Router events → FSM (`navigation.store`): resolve policy/direction/
//      scroll for every navigation (one-shot intents win, then the zone
//      default from navigation-transition.policy), adopt armed hook
//      transitions (O19), skip same-path, downgrade shallow to instant.
//   2. Store → DOM: mirror the FSM into `html[data-nav-phase/policy/
//      direction]` SYNCHRONOUSLY (Zustand listeners run inside set()), so
//      exit keyframes start in the same frame as the tap (O1 variant C).
//   3. Scroll contract (O6/O21): on routeChangeComplete, BEFORE entering —
//      reset both the inner `#main-content` scroller and the window (each is
//      a no-op where the other one owns scrolling), unless 'preserve'.
//   4. Focus & aria-busy (O8/O9): `aria-busy` on `#main-content` during
//      motion; focus lands on `#main-content` (fallback main/[role=main]/h1/
//      input) when the transition settles, except shallow/same-path/preserve.
//   5. Watchdogs: 600ms animationend caps for exit/enter and an armed-nav
//      watchdog so a hook navigation that never produced a route change can
//      never leave the FSM (and the hidden shell) stuck.
//   6. Hardware back: registers `triggerBack` (used by AppLifecycle's
//      Capacitor backButton listener) and keeps `beforePopState` stamping the
//      'back' direction for genuine browser/OS back-forward (unknown = back,
//      O17).
//   7. Leave-guard seam: `beforePopState` asks application/routing/
//      leave-guard.ts first and completed navigations snapshot the history
//      entry it restores (dialog + push seam: LeaveGuardDialog.composition).

import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  useNavigationStore,
  type NavigationState,
  type NavScrollMode,
} from '../../application/stores/navigation.store';
import {
  normalizeNavPathname,
  resolveDefaultNavPolicy,
} from '../../application/policies/navigation-transition.policy';
import {
  NAVIGATION_SHELL_ATTRIBUTE,
  runNavigationIntent,
} from '../../application/routing/navigation.possibilities.api';
import {
  interceptLeaveOnPopState,
  isLeaveGuardArmed,
  noteLeaveGuardHistoryEntry,
} from '../../application/routing/leave-guard';
import { getSessionStorage } from '../../application/client-device-storage/session-storage-adapter/sessionStorage.adapter';
import { STORAGE_KEYS } from '../../application/client-device-storage/storage-keys.config';

const NAV_EXIT_CAP_MS = 600;
const NAV_ENTER_CAP_MS = 600;
/** Armed hook nav that never produced a route change (e.g. back() with no
 * history on a browser without the Navigation API) must not leave a hidden
 * shell behind. Short on purpose: firing early degrades gracefully — the
 * already-issued router call still lands and replays as a best-effort
 * transition; content is only briefly blanked. */
const ARMED_NAV_WATCHDOG_MS = 400;

const PHASE_DOM_VALUE: Partial<Record<NavigationState['phase'], string>> = {
  exiting: 'exiting',
  waitingForRoute: 'waiting',
  entering: 'entering',
};

function stripped(url: string): string {
  return normalizeNavPathname(url);
}

function resolveScrollModeForTarget(strippedPathname: string): NavScrollMode {
  if (useNavigationStore.getState().consumeScrollPreserve()) {
    return 'preserve';
  }
  // O7: back/return to Explore with a saved list position → preserve, so the
  // page-level restore effect is not fought by the global reset.
  if (
    strippedPathname === ROUTES_FRONT.EXPLORE &&
    getSessionStorage(STORAGE_KEYS.EXPLORE_SCROLL_POSITION) !== null
  ) {
    return 'preserve';
  }
  return 'reset';
}

function focusAfterSettle(state: NavigationState): void {
  if (state.skipFocus) {
    return;
  }
  const active = document.activeElement;
  // Preserve-scroll navigations (locale switch, Explore restore) keep a
  // still-alive focus target (O2/O8) instead of yanking the user to main.
  if (
    state.scrollMode === 'preserve' &&
    active instanceof HTMLElement &&
    active !== document.body &&
    active.isConnected
  ) {
    return;
  }
  const target =
    document.getElementById('main-content') ??
    document.querySelector<HTMLElement>('main, [role="main"], h1, input');
  if (!target) {
    return;
  }
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), {
      once: true,
    });
  }
  target.focus({ preventScroll: true });
}

/** Mirror FSM → DOM. Idempotent; runs synchronously on every store change. */
function syncDomFromState(state: NavigationState, prev: NavigationState): void {
  const html = document.documentElement;
  const phaseValue = PHASE_DOM_VALUE[state.phase];
  if (phaseValue !== undefined && state.policy !== 'instant') {
    html.dataset['navPhase'] = phaseValue;
    html.dataset['navPolicy'] = state.policy;
    html.dataset['navDirection'] = state.direction;
  } else {
    delete html.dataset['navPhase'];
    delete html.dataset['navPolicy'];
    delete html.dataset['navDirection'];
  }

  const main = document.getElementById('main-content');
  if (main) {
    if (phaseValue !== undefined) {
      main.setAttribute('aria-busy', 'true');
    } else {
      main.removeAttribute('aria-busy');
    }
  }

  const settledNow =
    state.phase === 'idle' &&
    prev.phase !== 'idle' &&
    (prev.phase === 'entering' || prev.phase === 'instant');
  if (settledNow) {
    focusAfterSettle(state);
  }
}

export function NavigationTransitionControllerComposition(): null {
  const router = useRouter();

  // 2. + 5. Store → DOM mirror, caps and the armed-nav watchdog.
  useEffect(() => {
    const store = useNavigationStore;

    const scheduleCaps = (
      state: NavigationState,
      prev: NavigationState
    ): void => {
      const idChanged = state.transitionId !== prev.transitionId;
      if (
        state.phase === 'exiting' &&
        (prev.phase !== 'exiting' || idChanged)
      ) {
        const id = state.transitionId;
        setTimeout(() => store.getState().markExitDone(id), NAV_EXIT_CAP_MS);
      }
      if (
        state.phase === 'entering' &&
        (prev.phase !== 'entering' || idChanged)
      ) {
        const id = state.transitionId;
        setTimeout(() => store.getState().markEnterDone(id), NAV_ENTER_CAP_MS);
      }
      if (
        state.armedHookNav &&
        state.phase === 'waitingForRoute' &&
        prev.phase !== 'waitingForRoute'
      ) {
        const id = state.transitionId;
        setTimeout(() => {
          const current = store.getState();
          if (current.transitionId === id && current.armedHookNav) {
            current.failTransition(null);
          }
        }, ARMED_NAV_WATCHDOG_MS);
      }
    };

    const unsubscribe = store.subscribe((state, prev) => {
      syncDomFromState(state, prev);
      scheduleCaps(state, prev);
    });
    return unsubscribe;
  }, []);

  // 1. + 3. Router events → FSM + scroll contract.
  useEffect(() => {
    const store = useNavigationStore;

    const handleStart = (
      url: string,
      { shallow }: { shallow: boolean }
    ): void => {
      store.getState().clearIntentIfStale();
      const target = stripped(url);
      // A start following a popstate is the back/forward navigation itself —
      // consume the flag now (any later start is push-origin again).
      const isPopstateStart = store.getState().popstatePending;
      if (isPopstateStart) {
        store.setState({ popstatePending: false });
      }

      // O14: shallow / query-only filter sync is NEVER a screen change — it
      // must neither adopt nor cancel a live/armed transition (A5).
      if (shallow) {
        if (isPopstateStart) {
          // N1: a shallow popstate consumed the flag above but its stamped
          // back-intent would leak into the next real navigation.
          store.getState().clearPopstateRemnants();
        }
        if (store.getState().phase === 'idle') {
          store.getState().beginTransition({
            policy: 'instant',
            direction: 'forward',
            scrollMode: 'preserve',
            scrollModeExplicit: true,
            skipFocus: true,
            targetPathname: target,
            hookDriven: false,
          });
        }
        return;
      }

      // O19/O20: armed hook transition — adopt ONLY the start that belongs
      // to it: a matching target, or (for target-less back) a popstate-origin
      // start. Anything else is an interloper or a stale echo (A2).
      const s = store.getState();
      if (s.armedHookNav && s.phase !== 'idle') {
        const matchesTarget =
          s.targetPathname !== null && s.targetPathname === target;
        const matchesPopstateBack =
          s.targetPathname === null && isPopstateStart;
        if (matchesTarget || matchesPopstateBack) {
          // O7: the target is known only now — re-resolve the scroll contract
          // (e.g. back-to-Explore preserve) unless the intent chose explicitly.
          const reResolved = s.scrollModeExplicit
            ? undefined
            : resolveScrollModeForTarget(target);
          s.adoptRouteStart(target, reResolved);
          return;
        }
        if (
          s.issuedHookNavTarget !== null &&
          s.issuedHookNavTarget === target
        ) {
          // Stale start-echo of a SUPERSEDED hook nav — the newer armed nav
          // keeps priority (true last-wins); this echo dies via cancellation.
          return;
        }
        if (isPopstateStart && s.issuedBackNavPending) {
          // R2-M: the popstate echo of OUR OWN superseded back() — a genuine
          // user back has no pending issue. The newer armed nav keeps
          // priority; its performNav will supersede this history move.
          s.setIssuedBackNavPending(false);
          return;
        }
        // Genuine interloper (system redirect / fresh user raw nav) — the
        // later/authoritative navigation wins; fall through so its stamped
        // intent (if any) is consumed by the fresh resolution below.
        s.cancelArmedHookNav();
      }

      // Case 3: same-path push never enters the FSM. Compare against the
      // router's PREVIOUS route — window.location is ALREADY updated when a
      // popstate start arrives (A1), while router.asPath still holds the old
      // path at routeChangeStart time.
      if (target === stripped(router.asPath)) {
        store.getState().clearPopstateRemnants();
        return;
      }

      const intent = store.getState().consumeIntentFor(target);
      const hasShell =
        document.querySelector(`[${NAVIGATION_SHELL_ATTRIBUTE}]`) !== null;
      const policy = hasShell
        ? (intent?.policy ?? resolveDefaultNavPolicy(target))
        : 'instant';
      store.getState().beginTransition({
        policy,
        direction: intent?.direction ?? (isPopstateStart ? 'back' : 'forward'),
        scrollMode: intent?.scroll ?? resolveScrollModeForTarget(target),
        scrollModeExplicit: intent?.scroll !== undefined,
        skipFocus: false,
        targetPathname: target,
        hookDriven: false,
      });
    };

    const handleComplete = (url: string): void => {
      // Leave guard: the entry to restore when a popstate is refused is the
      // one this completed navigation (shallow query sync included) wrote.
      noteLeaveGuardHistoryEntry();
      const s = store.getState();
      if (s.phase === 'idle') {
        return;
      }
      // A completed navigation we never issued/observed cannot promote the
      // armed transition (A7) — and neither can a same-path-skipped or
      // superseded navigation whose url does not match the active target.
      if (s.armedHookNav) {
        return;
      }
      if (s.targetPathname !== null && stripped(url) !== s.targetPathname) {
        return;
      }
      // O6/O21: resolve scroll BEFORE entering. Reset BOTH scroll owners —
      // each is a no-op in layouts where the other one scrolls.
      if (s.scrollMode === 'reset') {
        const main = document.getElementById('main-content');
        if (main) {
          main.scrollTop = 0;
        }
        // behavior:'auto' — override globalnego scroll-behavior:smooth (global.css):
        // scroll-reset PRZED wejściem w view-transition musi być natychmiastowy
        // (O6/O21 resolve BEFORE entering; smooth zostawiłby stary scroll w kadrze
        // podczas przejścia). Instant = nowa strona startuje od góry pod cross-fade.
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
      s.markRouteReady(s.transitionId);
    };

    const handleError = (_error: unknown, url: string): void => {
      useNavigationStore.getState().failTransition(stripped(url));
    };

    // Hash-only popstate never produces a routeChangeStart — drop the flag
    // and the stamped back-intent so they cannot leak into the next real
    // navigation (A11).
    const handleHashChange = (): void => {
      useNavigationStore.getState().clearPopstateRemnants();
    };

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);
    router.events.on('routeChangeError', handleError);
    router.events.on('hashChangeStart', handleHashChange);
    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
      router.events.off('routeChangeError', handleError);
      router.events.off('hashChangeStart', handleHashChange);
    };
  }, [router]);

  // 6. Hardware/browser back wiring + BFCache recovery.
  useEffect(() => {
    const store = useNavigationStore;

    // O17: pages router exposes no history idx — any genuine popstate is
    // treated as back (Android-first; browser forward accepted as back).
    router.beforePopState(state => {
      // Leave guard (useLeaveGuard): a refused back keeps the screen and
      // opens the dialog; the popstate never reaches the FSM. Unarmed = one
      // cheap check, identical behaviour for every page without a guard.
      if (isLeaveGuardArmed() && interceptLeaveOnPopState(state.as)) {
        return false;
      }
      store.getState().notePopstate();
      return true;
    });

    // A hard navigation mid-phase (window.location.*, Stripe hosted) can
    // freeze the page into BFCache with data-nav-* attrs applied; restoring
    // it would show a hidden, inert shell forever (adversarial L3). pageshow
    // with persisted=true is the restore signal — reset the FSM.
    const handlePageShow = (event: PageTransitionEvent): void => {
      if (event.persisted && store.getState().phase !== 'idle') {
        store.getState().failTransition(null);
      }
    };
    window.addEventListener('pageshow', handlePageShow);

    const triggerBack = (): void => {
      void runNavigationIntent(
        { direction: 'back', reason: 'trigger-back' },
        () => {
          router.back();
        }
      );
    };
    store.getState().setTriggerBack(triggerBack);
    store.getState().setControllerMounted(true);

    return () => {
      window.removeEventListener('pageshow', handlePageShow);
      router.beforePopState(() => true);
      store.getState().setTriggerBack(null);
      store.getState().setControllerMounted(false);
    };
  }, [router]);

  return null;
}

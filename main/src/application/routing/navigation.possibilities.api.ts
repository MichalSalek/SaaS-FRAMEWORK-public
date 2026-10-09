// Imperative navigation-intent seams (NVT public API) — module-level so
// non-React call sites (redirections.ts, guards, AppLifecycle) can drive the
// transition FSM without hooks:
//
//   - `runNavigationIntent(intent, performNav)` — the general seam. For
//     'slide' / 'fade' hook navigations it runs EXIT-FIRST-THEN-NAVIGATE
//     (O19, see navigation.store.ts DECISION): opens the exiting phase, waits
//     for the exit animation (animationend / cap / unmount), then invokes
//     `performNav`. For 'instant' (and when the shell/controller is absent)
//     it stamps a target-bound one-shot intent and navigates immediately.
//   - `runInstant(reason, performNav)` — system/identity redirect seam
//     (guards, event pipeline, becomeUser/switchBack): no product motion.
//   - `preserveNextScroll(reason)` — one-shot scroll-preserve for the next
//     navigation (Explore restore, locale switch companions).

import {
  useNavigationStore,
  type NavigationIntent,
  type NavScrollMode,
} from '../stores/navigation.store';
import {
  normalizeNavPathname,
  resolveDefaultNavPolicy,
} from '../policies/navigation-transition.policy';
import { bypassLeaveGuard, requestLeave } from './leave-guard';

export const NAVIGATION_SHELL_ATTRIBUTE = 'data-navigation-content-shell';

/** Waiter must never outlive the controller-scheduled 600ms exit cap — if the
 * controller unmounted mid-transition (dev/HMR teardown), resolve anyway so
 * the navigation is not silently lost and the subscription is released. */
const EXIT_WAIT_FALLBACK_MS = 850;

function shellPresent(): boolean {
  return document.querySelector(`[${NAVIGATION_SHELL_ATTRIBUTE}]`) !== null;
}

/**
 * Chromium Navigation API — the only reliable "is there anywhere to go back
 * to" signal (history.length counts entries AHEAD of the current position
 * too). undefined = API unavailable (Safari/Firefox) → caller falls back.
 */
export function canGoBackNow(): boolean | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const nav = (window as { navigation?: { canGoBack?: boolean } }).navigation;
  return typeof nav?.canGoBack === 'boolean' ? nav.canGoBack : undefined;
}

/** Resolves once the exit animation of transition `id` finished — or the
 * transition was superseded/cancelled (in which case the armed navigation
 * must NOT run: last-wins). */
function waitForExitOutcome(id: number): Promise<'proceed' | 'superseded'> {
  return new Promise(resolve => {
    let unsubscribe: (() => void) | null = null;
    let fallback: ReturnType<typeof setTimeout> | null = null;
    const settle = (outcome: 'proceed' | 'superseded'): void => {
      if (fallback !== null) {
        clearTimeout(fallback);
        fallback = null;
      }
      unsubscribe?.();
      unsubscribe = null;
      resolve(outcome);
    };
    const evaluate = (state = useNavigationStore.getState()): boolean => {
      if (state.transitionId !== id || state.phase === 'idle') {
        settle('superseded');
        return true;
      }
      if (state.exitDone) {
        settle('proceed');
        return true;
      }
      return false;
    };
    if (evaluate()) {
      return;
    }
    unsubscribe = useNavigationStore.subscribe(state => {
      evaluate(state);
    });
    fallback = setTimeout(() => evaluate(), EXIT_WAIT_FALLBACK_MS);
  });
}

function resolveScrollMode(intent: NavigationIntent): {
  mode: NavScrollMode;
  explicit: boolean;
} {
  if (intent.scroll) {
    return { mode: intent.scroll, explicit: true };
  }
  if (useNavigationStore.getState().consumeScrollPreserve()) {
    return { mode: 'preserve', explicit: true };
  }
  // Not explicit: adoption may re-resolve for the freshly known target (O7).
  return { mode: 'reset', explicit: false };
}

/**
 * Drive a navigation through the transition FSM.
 *
 * Returns the `performNav` result — or `undefined` when the armed navigation
 * was superseded before it ran (rapid re-navigation: last intent wins).
 */
export async function runNavigationIntent<T>(
  intent: NavigationIntent,
  performNav: () => T | Promise<T>
): Promise<T | undefined> {
  if (typeof window === 'undefined') {
    return await performNav();
  }

  const store = useNavigationStore;
  const target =
    intent.targetPathname === undefined
      ? null
      : intent.targetPathname === null
        ? null
        : normalizeNavPathname(intent.targetPathname);
  const currentPathname = normalizeNavPathname(window.location.pathname);

  // Target-less back with nowhere to go (history position 0, e.g. deep-link
  // landing): a full exit-first cycle would blank the content only to bring
  // it back (adversarial A8). Mirror the pre-NVT dead-button no-op.
  if (
    intent.direction === 'back' &&
    target === null &&
    canGoBackNow() === false
  ) {
    return undefined;
  }

  // Same-path navigation never enters the FSM (case 3) — run it plainly.
  // Exception: an EXPLICIT policy (locale switch: same pathname, new locale)
  // declares the same-path nav as a real, animated transition.
  if (
    intent.policy === undefined &&
    target !== null &&
    target === currentPathname
  ) {
    return await performNav();
  }

  // Leave guard (useLeaveGuard): ask BEFORE the FSM is armed. Refusing later
  // (in the router seam) would first play the exit animation and blank the
  // screen the user decided to stay on. Confirming re-runs this same intent,
  // which then passes on the one-shot bypass. A target-less FORWARD intent
  // (system redirect with an unknown url) is left to the router seam, which
  // sees the real url; only a target-less BACK is a known leave.
  const leavesTo =
    target !== null || intent.direction === 'back' ? target : undefined;
  if (
    leavesTo !== undefined &&
    !requestLeave(leavesTo, () => {
      void runNavigationIntent(intent, performNav);
    })
  ) {
    return undefined;
  }

  const policy =
    intent.policy ??
    resolveDefaultNavPolicy(target ?? window.location.pathname);
  const direction = intent.direction ?? 'forward';

  const exitFirstEligible =
    policy !== 'instant' &&
    store.getState().controllerMounted &&
    shellPresent();

  if (exitFirstEligible) {
    // O19 exit-first: no pending intent is stamped — the transition itself
    // carries policy/direction and routeChangeStart is ADOPTED by target.
    const scroll = resolveScrollMode(intent);
    const id = store.getState().beginTransition({
      policy,
      direction,
      scrollMode: scroll.mode,
      scrollModeExplicit: scroll.explicit,
      skipFocus: false,
      targetPathname: target,
      hookDriven: true,
    });
    const outcome = await waitForExitOutcome(id);
    if (outcome === 'superseded') {
      return undefined;
    }
    // Record the issued nav so the controller can tell a stale start-echo of
    // a SUPERSEDED hook nav apart from a fresh interloper (last-wins, A-race).
    store.getState().setIssuedHookNavTarget(target);
    if (target === null) {
      // R2-M: a target-less back() echoes as a popstate start — mark it so
      // the echo cannot cancel a newer armed hook nav.
      store.getState().setIssuedBackNavPending(true);
    }
    return await performNav();
  }

  // Immediate navigation — stamp a target-bound one-shot intent that the
  // controller consumes on the matching routeChangeStart (O20).
  const stamped = store.getState().stampIntent({
    ...intent,
    policy,
    direction,
    targetPathname: target,
  });
  try {
    return await performNav();
  } finally {
    // Clear-after-settle: a real navigation consumed the intent synchronously
    // inside performNav (routeChangeStart fires before the router promise
    // resolves). Still pending here ⇒ no navigation happened (e.g. same-path
    // no-op inside a redirect seam) — drop it so it cannot leak.
    if (store.getState().pendingIntent === stamped) {
      store.setState({ pendingIntent: null });
    }
  }
}

/** System/identity redirect seam — no product motion (guards, pipeline,
 * becomeUser/switchBack, login-first/user-disabled). Pass `targetUrl` when
 * the destination is known so the one-shot intent stays target-bound (O20). */
export async function runInstant<T>(
  reason: string,
  performNav: () => T | Promise<T>,
  targetUrl?: string
): Promise<T | undefined> {
  // System redirects never ask (leave-guard.ts bypassLeaveGuard).
  bypassLeaveGuard();
  return await runNavigationIntent(
    { policy: 'instant', reason, targetPathname: targetUrl ?? null },
    performNav
  );
}

/** One-shot: the NEXT navigation preserves the target scroll position. */
export function preserveNextScroll(reason: string): void {
  void reason;
  useNavigationStore.getState().preserveNextScroll();
}

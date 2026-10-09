// Navigation transition FSM store (NVT) — the ONE source of truth for page
// transition state. Replaces `navDirection.store.ts` (deleted with the old
// View-Transition bridge). Consumed by:
//
//   - `NavigationTransitionController.composition.tsx` — the single subscriber
//     of Next router events; mirrors this FSM into `html[data-nav-*]` attrs.
//   - `NavigationContentShell.composition.tsx` — reports exit/enter
//     `animationend` (and unmount-as-exitDone) back into the FSM.
//   - `useNativeRouter` / module-level seams (`runNavigationIntent`,
//     `runInstant`, `preserveNextScroll`) — stamp one-shot intents.
//   - `AppLifecycle` Capacitor hardware-back handler — reads `triggerBack`.
//
// FSM (PLAN_NAVIGATION_TRANSITIONS §FSM Contract):
//   idle → exiting → (waitingForRoute) → entering → idle
//   idle → instant → idle
//
// DECISION (nie usuwaj tego komentarza) — O19 dual-grade exit:
// Next Pages Router does NOT await routeChangeStart listeners and commits the
// new page before routeChangeComplete, so an event-driven exit animation gets
// truncated by the DOM swap on fast (prefetched) routes. Hook-driven
// navigations (useNativeRouter push/replace/back + triggerBack) therefore run
// EXIT-FIRST-THEN-NAVIGATE: `runNavigationIntent` opens the exiting phase
// immediately and only calls the router once the exit animation finished
// (animationend / 600ms cap / shell unmount). Raw `router.push` / `<Link>` /
// browser-popstate remain best-effort: exit starts on routeChangeStart and the
// old shell's unmount marks exitDone, so entering follows without a stall.
//
// DECISION (nie usuwaj tego komentarza) — O20 target-bound one-shot intents:
// `router.change()` has an async gap (`await this._bfl(...)`) before emitting
// routeChangeStart, so a pending intent could be consumed by an unrelated
// navigation racing through that window. Intents carry `targetPathname` and
// are consumed only by a matching start (locale-stripped compare); `back()`
// intents (unknown target) match any start but expire after INTENT_TTL_MS.
// `runNavigationIntent` clears its own intent after `performNav` settles
// (clear-after-settle) so a no-op seam call never leaks an intent into the
// next unrelated navigation.

import { create } from 'zustand';
import type { NavTransitionPolicy } from '../policies/navigation-transition.policy';

type NavDirection = 'forward' | 'back';
export type NavScrollMode = 'reset' | 'preserve';
type NavPhase = 'idle' | 'exiting' | 'waitingForRoute' | 'entering' | 'instant';

export interface NavigationIntent {
  policy?: NavTransitionPolicy;
  direction?: NavDirection;
  scroll?: NavScrollMode;
  /** Diagnostic label — surfaces in dev tooling, never parsed. */
  reason: string;
  /** Locale-stripped target pathname when known; null = back/popstate. */
  targetPathname?: string | null;
}

interface StampedIntent extends NavigationIntent {
  stampedAt: number;
}

/** Stale one-shot intents (e.g. an aborted popstate) expire instead of
 * leaking a wrong direction/policy into the next unrelated navigation. */
const INTENT_TTL_MS = 2000;

export interface BeginTransitionConfig {
  policy: NavTransitionPolicy;
  direction: NavDirection;
  scrollMode: NavScrollMode;
  /** true when the caller (intent / one-shot) chose the scroll mode — adoption
   * must NOT re-resolve it for the freshly known target (O7 vs O2). */
  scrollModeExplicit: boolean;
  skipFocus: boolean;
  targetPathname: string | null;
  /** O19: exit-first hook transition — routeChangeStart is ADOPTED, not restarted. */
  hookDriven: boolean;
}

export interface NavigationState {
  phase: NavPhase;
  transitionId: number;
  policy: NavTransitionPolicy;
  direction: NavDirection;
  scrollMode: NavScrollMode;
  skipFocus: boolean;
  /** Locale-stripped pathname of the in-flight navigation (error matching). */
  targetPathname: string | null;
  exitDone: boolean;
  routeReady: boolean;
  /** Hook transition began, its router call not yet observed as a start. */
  armedHookNav: boolean;
  scrollModeExplicit: boolean;
  /** A popstate fired and its routeChangeStart has not been seen yet —
   * distinguishes genuine back/forward starts from pushes (adoption rule for
   * target-less armed back, O20). */
  popstatePending: boolean;
  /** Target of the hook performNav most recently ISSUED to the router —
   * lets the controller ignore the stale start-echo of a superseded hook nav
   * instead of cancelling the newer armed one (last-wins). */
  issuedHookNavTarget: string | null;
  /** A target-less hook back() was ISSUED and its popstate start has not been
   * observed yet — its echo must not cancel a newer armed hook nav (R2-M:
   * back-then-fast-tap race). A GENUINE user back has no pending issue. */
  issuedBackNavPending: boolean;
  pendingIntent: StampedIntent | null;
  pendingScrollPreserve: boolean;
  /** Registered by the controller; read by AppLifecycle hardware-back. */
  triggerBack: (() => void) | null;
  controllerMounted: boolean;

  stampIntent: (intent: NavigationIntent) => StampedIntent;
  /** Consume iff target matches (or intent is target-less) and not expired. */
  consumeIntentFor: (strippedPathname: string) => NavigationIntent | null;
  clearIntentIfStale: () => void;
  /** popstate observed: flag the upcoming start + stamp 'back' direction when
   * nothing else already claimed the navigation. */
  notePopstate: () => void;
  /** The pending popstate start was consumed / skipped / never materialised
   * (hash-only) — drop the flag and any leftover target-less popstate intent. */
  clearPopstateRemnants: () => void;
  preserveNextScroll: () => void;
  consumeScrollPreserve: () => boolean;
  setIssuedHookNavTarget: (target: string | null) => void;
  setIssuedBackNavPending: (pending: boolean) => void;

  beginTransition: (cfg: BeginTransitionConfig) => number;
  adoptRouteStart: (
    strippedPathname: string,
    reResolvedScrollMode?: NavScrollMode
  ) => void;
  cancelArmedHookNav: () => void;
  markExitDone: (id: number) => void;
  markRouteReady: (id: number) => void;
  markEnterDone: (id: number) => void;
  failTransition: (strippedPathname: string | null) => void;

  setTriggerBack: (fn: (() => void) | null) => void;
  setControllerMounted: (mounted: boolean) => void;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : 0;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  phase: 'idle',
  transitionId: 0,
  policy: 'instant',
  direction: 'forward',
  scrollMode: 'reset',
  skipFocus: false,
  targetPathname: null,
  exitDone: false,
  routeReady: false,
  armedHookNav: false,
  scrollModeExplicit: false,
  popstatePending: false,
  issuedHookNavTarget: null,
  issuedBackNavPending: false,
  pendingIntent: null,
  pendingScrollPreserve: false,
  triggerBack: null,
  controllerMounted: false,

  stampIntent: intent => {
    const stamped: StampedIntent = { ...intent, stampedAt: now() };
    set({ pendingIntent: stamped });
    return stamped;
  },

  consumeIntentFor: strippedPathname => {
    const intent = get().pendingIntent;
    if (!intent) {
      return null;
    }
    const target = intent.targetPathname ?? null;
    // TTL applies ONLY to target-less (popstate/back) intents — a target-bound
    // intent can only ever be consumed by its own start, and slow networks can
    // delay routeChangeStart past any reasonable TTL (adversarial A9).
    if (target === null && now() - intent.stampedAt > INTENT_TTL_MS) {
      set({ pendingIntent: null });
      return null;
    }
    if (target !== null && target !== strippedPathname) {
      // O20: not ours — leave it pending for its own routeChangeStart.
      return null;
    }
    set({ pendingIntent: null });
    return intent;
  },

  clearIntentIfStale: () => {
    const intent = get().pendingIntent;
    if (
      intent &&
      (intent.targetPathname ?? null) === null &&
      now() - intent.stampedAt > INTENT_TTL_MS
    ) {
      set({ pendingIntent: null });
    }
  },

  notePopstate: () => {
    const s = get();
    set({ popstatePending: true });
    // Direction net — only when nothing else already claimed the navigation:
    // an armed hook transition (triggerBack) knows its direction; an explicit
    // pending intent already claimed the upcoming start.
    if (s.armedHookNav || s.pendingIntent !== null) {
      return;
    }
    set({
      pendingIntent: {
        direction: 'back',
        reason: 'popstate',
        targetPathname: null,
        stampedAt: now(),
      },
    });
  },

  clearPopstateRemnants: () => {
    const s = get();
    const isPopstateIntent =
      s.pendingIntent !== null &&
      (s.pendingIntent.targetPathname ?? null) === null &&
      s.pendingIntent.reason === 'popstate';
    set({
      popstatePending: false,
      ...(isPopstateIntent && { pendingIntent: null }),
    });
  },

  preserveNextScroll: () => set({ pendingScrollPreserve: true }),

  consumeScrollPreserve: () => {
    if (!get().pendingScrollPreserve) {
      return false;
    }
    set({ pendingScrollPreserve: false });
    return true;
  },

  setIssuedHookNavTarget: target => set({ issuedHookNavTarget: target }),
  setIssuedBackNavPending: pending => set({ issuedBackNavPending: pending }),

  beginTransition: cfg => {
    const id = get().transitionId + 1;
    set({
      phase: cfg.policy === 'instant' ? 'instant' : 'exiting',
      transitionId: id,
      policy: cfg.policy,
      direction: cfg.direction,
      scrollMode: cfg.scrollMode,
      scrollModeExplicit: cfg.scrollModeExplicit,
      skipFocus: cfg.skipFocus,
      targetPathname: cfg.targetPathname,
      exitDone: false,
      routeReady: false,
      armedHookNav: cfg.hookDriven,
    });
    return id;
  },

  adoptRouteStart: (strippedPathname, reResolvedScrollMode) => {
    // R3-F1 nano: a popstate intent stamped BEFORE this hook nav armed would
    // linger (its start was adopted, not resolved) and flip the direction of
    // the next navigation — retire it together with the adoption.
    const pending = get().pendingIntent;
    const isPopstateIntent =
      pending !== null &&
      (pending.targetPathname ?? null) === null &&
      pending.reason === 'popstate';
    set({
      armedHookNav: false,
      targetPathname: strippedPathname,
      issuedHookNavTarget: null,
      issuedBackNavPending: false,
      ...(isPopstateIntent && { pendingIntent: null }),
      ...(reResolvedScrollMode !== undefined && {
        scrollMode: reResolvedScrollMode,
      }),
    });
  },

  cancelArmedHookNav: () => {
    if (!get().armedHookNav) {
      return;
    }
    // Bump the id so waitForExitOutcome resolves 'superseded' and the armed
    // performNav is never invoked (last-wins / guard-authority wins).
    set(state => ({
      phase: 'idle',
      transitionId: state.transitionId + 1,
      armedHookNav: false,
      issuedHookNavTarget: null,
      issuedBackNavPending: false,
      skipFocus: true,
    }));
  },

  markExitDone: id => {
    const s = get();
    if (s.transitionId !== id || s.phase !== 'exiting' || s.exitDone) {
      return;
    }
    set({
      exitDone: true,
      phase: s.routeReady ? 'entering' : 'waitingForRoute',
    });
  },

  markRouteReady: id => {
    const s = get();
    if (s.transitionId !== id || s.phase === 'idle') {
      return;
    }
    if (s.phase === 'instant') {
      // N2/R3-F1: settle retires BOTH issued-nav markers — they must never
      // survive into a later transition and swallow a foreign start/back.
      set({
        routeReady: true,
        phase: 'idle',
        issuedHookNavTarget: null,
        issuedBackNavPending: false,
      });
      return;
    }
    if (s.phase === 'waitingForRoute') {
      set({ routeReady: true, phase: 'entering' });
      return;
    }
    // 'exiting': route resolved before the exit finished — stay; the exit
    // animationend / cap / old-shell unmount promotes to 'entering'.
    set({ routeReady: true });
  },

  markEnterDone: id => {
    const s = get();
    if (s.transitionId !== id || s.phase !== 'entering') {
      return;
    }
    // N2/R3-F1: settle retires both issued-nav markers (see markRouteReady).
    set({
      phase: 'idle',
      issuedHookNavTarget: null,
      issuedBackNavPending: false,
    });
  },

  failTransition: strippedPathname => {
    const s = get();
    if (s.phase === 'idle') {
      return;
    }
    // ARMED transition: its router call has not produced a start yet, so any
    // routeChangeError observed now belongs to a DIFFERENT (superseded)
    // navigation — even when the url matches our target (adversarial A6:
    // cancellation of an old nav to the SAME pathname). Only the explicit
    // watchdog reset (strippedPathname === null) may kill an armed nav.
    if (s.armedHookNav && strippedPathname !== null) {
      return;
    }
    // A stale routeChangeError from a superseded navigation carries the OLD
    // target — ignore it; only the active transition's failure resets the FSM.
    if (
      strippedPathname !== null &&
      s.targetPathname !== null &&
      strippedPathname !== s.targetPathname
    ) {
      return;
    }
    set({
      phase: 'idle',
      armedHookNav: false,
      issuedHookNavTarget: null,
      issuedBackNavPending: false,
      skipFocus: true,
    });
  },

  setTriggerBack: fn => set({ triggerBack: fn }),
  setControllerMounted: mounted => set({ controllerMounted: mounted }),
}));

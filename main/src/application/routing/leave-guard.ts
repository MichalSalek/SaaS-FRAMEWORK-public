// Leave guard: the ONE mechanism that protects unsaved work when the user
// leaves a screen (owner decision 2026-09-25). React side: `useLeaveGuard`
// (UI/shared/hooks). Dialog + router seam: `LeaveGuardDialog.composition`
// (UI/layouts, mounted once in `_app`).
//
// DECISION (nie usuwaj tego komentarza):
// Rejestr żyje na poziomie modułu, a nie w kontekście Reacta, bo pytają go
// miejsca spoza drzewa komponentów: `runNavigationIntent` (pasek zakładek,
// szuflada, wstecz w pasku aplikacji, sprzętowe „wstecz" Androida przez
// `triggerBack`), `beforePopState` w NavigationTransitionController (wstecz
// przeglądarki i gest WebView, czyli popstate) oraz nakładka na `router.push`
// / `router.replace` (AppLinkAtom i ponad sto bezpośrednich wywołań routera).
// Trasy NIE anulujemy wyjątkiem z `routeChangeStart` (jedyny „oficjalny"
// sposób w pages routerze): wtedy FSM przejść już wystartowałby animację
// wyjścia, a Next zostawiłby odrzuconą obietnicę. Zamiast tego pytamy ZANIM
// nawigacja się zacznie: `runNavigationIntent` przed uzbrojeniem FSM, nakładka
// routera przed wywołaniem Nexta. Popstate da się tylko cofnąć po fakcie:
// `beforePopState` zwraca false, a my odkładamy z powrotem wpis historii
// bieżącego ekranu (zapamiętany stan Nexta), więc wynik jest poprawny i przy
// „wstecz", i przy „dalej". Pusty rejestr = każda ścieżka przechodzi bez
// zmian, więc strony bez `useLeaveGuard` niczego nie odczuwają. Potwierdzenie
// „Wyjdź" daje jednorazową przepustkę (znika razem z ostatnim strażnikiem albo
// po LEAVE_BYPASS_MS), dzięki której powtórzona nawigacja nie pyta drugi raz.

import type { UrlObject } from 'url';
import { normalizeNavPathname } from '../policies/navigation-transition.policy';

export type LeavePromptKind = 'leave' | 'discard';

export interface LeavePrompt {
  kind: LeavePromptKind;
  message: string;
  confirm: () => void;
  cancel: () => void;
}

export type LeaveDecision = 'allow' | 'block';

interface GuardEntry {
  id: number;
  message: string;
}

interface HistoryEntrySnapshot {
  state: unknown;
  url: string;
}

/** A confirmed leave must survive the exit animation (≤ 600 ms cap plus the
 * 850 ms waiter fallback) and a slow route load; after that the guard re-arms
 * for a user who is, in the end, still on the screen. */
export const LEAVE_BYPASS_MS = 5000;

let entries: readonly GuardEntry[] = [];
let nextEntryId = 1;
let bypassUntil = 0;
let prompt: LeavePrompt | null = null;
let historyEntry: HistoryEntrySnapshot | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function setPrompt(next: LeavePrompt | null): void {
  prompt = next;
  emit();
}

function isBypassed(now: number): boolean {
  return bypassUntil > now;
}

/**
 * Pure decision: may a navigation from `currentPathname` to `targetPathname`
 * proceed? `targetPathname === null` = unknown destination (history back),
 * which leaves the screen by definition. Pathnames are compared normalized
 * (locale prefix, trailing slash, query and hash dropped): a query-only or
 * locale-only change keeps the screen and its draft mounted.
 */
export function decideLeave(input: {
  guarded: boolean;
  bypassed: boolean;
  currentPathname: string;
  targetPathname: string | null;
}): LeaveDecision {
  if (!input.guarded || input.bypassed) {
    return 'allow';
  }
  if (
    input.targetPathname !== null &&
    normalizeNavPathname(input.targetPathname) ===
      normalizeNavPathname(input.currentPathname)
  ) {
    return 'allow';
  }
  return 'block';
}

/**
 * Pathname of a `router.push` target: a string (path, absolute URL, or a URL
 * relative to the current screen such as `?tab=x`) or a Next url object whose
 * dynamic segments (`[id]`, `[...slug]`, `[[...slug]]`) are filled from its
 * query.
 */
export function resolveTargetPathname(
  url: string | UrlObject,
  fallbackPathname: string
): string {
  if (typeof url === 'string') {
    // A root-relative path is already what decideLeave compares; anything
    // else (absolute, protocol-relative, `?query`, `#hash`, `sibling`) is
    // resolved against the current screen like the router does. Returning a
    // bare `?tab=x` compared as an empty pathname and blocked a query-only
    // change of the guarded screen itself.
    if (url.startsWith('/') && !url.startsWith('//')) {
      return url;
    }
    try {
      return new URL(url, `http://placeholder.invalid${fallbackPathname}`)
        .pathname;
    } catch {
      return url;
    }
  }
  const pathname = url.pathname ?? fallbackPathname;
  const query = url.query;
  if (typeof query !== 'object' || query === null) {
    return pathname;
  }
  return pathname.replace(
    /\[\[?(?:\.\.\.)?([^\]]+)\]\]?/g,
    (segment, name: string) => {
      const value = query[name];
      if (value === undefined || value === null) {
        return segment;
      }
      return typeof value === 'object'
        ? value.map(String).join('/')
        : String(value);
    }
  );
}

/** Register an active guard; returns its release function. */
export function registerLeaveGuard(message: string): () => void {
  const entry: GuardEntry = { id: nextEntryId, message };
  nextEntryId += 1;
  entries = [...entries, entry];
  noteLeaveGuardHistoryEntry();
  return () => {
    entries = entries.filter(candidate => candidate.id !== entry.id);
    // Deferred: a guard whose message or condition changed re-registers in the
    // same commit (cleanup, then effect) and must not flash the registry empty.
    queueMicrotask(() => {
      if (entries.length > 0) {
        return;
      }
      // The last guard is gone (screen left or draft saved): no pass may
      // outlive it and no dialog may keep asking about work that no longer
      // exists. Closing = staying, so a pending navigation is simply dropped.
      bypassUntil = 0;
      if (prompt !== null) {
        const stale = prompt;
        setPrompt(null);
        stale.cancel();
      }
    });
  };
}

/**
 * System navigation that must never ask (auth teardown redirects, identity
 * switches, other `runInstant` redirects): the app already decided, and a
 * dialog there either traps the user in a dead session or cancels a reload
 * that has already swapped the tokens. Opens the same one-time pass a
 * confirmed leave does (router seam and beforeunload both honour it).
 */
export function bypassLeaveGuard(now: number = Date.now()): void {
  // Closing = staying, so an open dialog resolves as cancel: a pending
  // `confirmDiscard` settles `false` instead of hanging forever.
  resolveLeavePrompt('cancel');
  // No guard = nothing to pass. A pass opened anyway would outlive the
  // redirect and silently wave through the first guard the NEXT screen
  // registers within the window (the release that normally clears it only
  // runs when a guard goes away).
  if (entries.length > 0) {
    bypassUntil = now + LEAVE_BYPASS_MS;
  }
}

/** Is any guard active right now (and not passed by a confirmed leave)? */
export function isLeaveGuardArmed(now: number = Date.now()): boolean {
  return entries.length > 0 && !isBypassed(now);
}

/** beforeunload side: a confirmed in-app leave may end in a hard load. */
export function isLeaveBypassed(now: number = Date.now()): boolean {
  return isBypassed(now);
}

function activeMessage(): string {
  return entries[entries.length - 1]?.message ?? '';
}

/**
 * Snapshot the history entry of the CURRENT screen, used to restore it when a
 * popstate is refused. Called on registration and by the navigation
 * controller after every completed route change (shallow query sync included).
 */
export function noteLeaveGuardHistoryEntry(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const state: unknown = window.history.state;
  historyEntry = { state, url: window.location.href };
}

/**
 * Push-origin navigation gate. Returns true when the caller may navigate now.
 * Returns false when it must not: a dialog is open (or an open one was
 * dismissed, so a second back press closes the dialog like on Android) and
 * `proceed` runs only after the user confirms.
 */
export function requestLeave(
  targetPathname: string | null,
  proceed: () => void
): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  const decision = decideLeave({
    guarded: entries.length > 0,
    bypassed: isBypassed(Date.now()),
    currentPathname: window.location.pathname,
    targetPathname,
  });
  if (decision === 'allow') {
    return true;
  }
  if (prompt !== null) {
    resolveLeavePrompt('cancel');
    return false;
  }
  setPrompt({
    kind: 'leave',
    message: activeMessage(),
    confirm: () => {
      bypassUntil = Date.now() + LEAVE_BYPASS_MS;
      proceed();
    },
    cancel: () => undefined,
  });
  return false;
}

/**
 * Popstate gate, called from `beforePopState` with the destination `as`.
 * Returns true when the history move was refused: the current entry is pushed
 * back (works for both back and forward) and the dialog asks; confirming goes
 * back one entry, which is exactly the refused destination either way.
 */
export function interceptLeaveOnPopState(targetAs: string): boolean {
  if (typeof window === 'undefined' || historyEntry === null) {
    return false;
  }
  // The popstate already moved window.location; the screen still mounted is
  // the one in the snapshot.
  const currentPathname = new URL(historyEntry.url).pathname;
  const decision = decideLeave({
    guarded: entries.length > 0,
    bypassed: isBypassed(Date.now()),
    currentPathname,
    targetPathname: targetAs,
  });
  if (decision === 'allow') {
    return false;
  }
  window.history.pushState(historyEntry.state, '', historyEntry.url);
  if (prompt !== null) {
    resolveLeavePrompt('cancel');
    return true;
  }
  setPrompt({
    kind: 'leave',
    message: activeMessage(),
    confirm: () => {
      bypassUntil = Date.now() + LEAVE_BYPASS_MS;
      window.history.back();
    },
    cancel: () => undefined,
  });
  return true;
}

/**
 * In-screen discard (switching the edited record over a dirty draft): the same
 * dialog, resolved as a promise. Resolves false when another prompt is open.
 */
export function confirmDiscard(message: string): Promise<boolean> {
  if (prompt !== null) {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    setPrompt({
      kind: 'discard',
      message,
      confirm: () => resolve(true),
      cancel: () => resolve(false),
    });
  });
}

/** `confirmDiscard` only when there is a draft to lose; clean = true now. */
export function confirmDiscardIfDirty(
  isDirty: boolean,
  message: string
): Promise<boolean> {
  return isDirty ? confirmDiscard(message) : Promise.resolve(true);
}

export function resolveLeavePrompt(decision: 'confirm' | 'cancel'): void {
  const current = prompt;
  if (current === null) {
    return;
  }
  setPrompt(null);
  if (decision === 'confirm') {
    current.confirm();
  } else {
    current.cancel();
  }
}

export function getLeavePrompt(): LeavePrompt | null {
  return prompt;
}

export function subscribeLeavePrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: drop every guard, pass, prompt and snapshot. */
export function resetLeaveGuardForTests(): void {
  entries = [];
  bypassUntil = 0;
  prompt = null;
  historyEntry = null;
  emit();
}

// The Pages Router restores window offsets only. The mobile app scrolls an
// inner main, so keep both positions against Next's per-history-entry key.
// Memory is tab-local, bounded, and discarded when identity changes.
import { useEffect, useRef } from 'react';
import { restore, type Position } from './history-scroll-restore';
export { resetRouteScroll } from './history-scroll-restore';
import {
  AUTH_IDENTITY_WILL_CHANGE_EVENT,
  AUTH_TOKEN_CLEARED_EVENT,
} from '../../application/auth/auth-token-teardown';
import { normalizeNavPathname } from '../../application/policies/navigation-transition.policy';

interface PendingPosition {
  key: string;
  position: Position;
  lastMain: number;
  lastY: number;
}

const LIMIT = 100;
interface EntryMemory {
  path: string;
  position?: Position;
  layouts?: Record<string, 'tiles' | 'full-width'>;
}
const positions = new Map<string, EntryMemory>();
let identityInvalidated = false;
let scrollOption: { ticket: symbol; target: string; preserve: boolean } | null =
  null;

/** Match options to the specific guarded call, including concurrent calls. */
export function noteScrollOption(
  target: string,
  scroll: boolean | undefined
): () => void {
  const ticket = Symbol('scroll-option');
  scrollOption = {
    ticket,
    target: normalizeNavPathname(target),
    preserve: scroll === false,
  };
  return () => {
    if (scrollOption?.ticket === ticket) {
      scrollOption = null;
    }
  };
}

function entryKey(): string | null {
  const state: unknown = window.history.state;
  if (typeof state !== 'object' || state === null || !('key' in state)) {
    return null;
  }
  return typeof state.key === 'string' ? state.key : null;
}

function isApp(url: string): boolean {
  const path = new URL(url, window.location.href).pathname;
  return /^\/(?:pl\/|en\/|de\/)?app(?:\/|$)/.test(path);
}

function storeEntry(key: string, entry: EntryMemory): void {
  positions.delete(key);
  positions.set(key, entry);
  if (positions.size > LIMIT) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) {
      positions.delete(oldest);
    }
  }
}

/** Small per-entry UI preference needed to restore gallery geometry. */
export function readGalleryLayout(
  surface: string
): 'tiles' | 'full-width' | null {
  if (
    typeof window === 'undefined' ||
    identityInvalidated ||
    !isApp(window.location.href)
  ) {
    return null;
  }
  const key = entryKey();
  const entry = key ? positions.get(key) : undefined;
  const path = normalizeNavPathname(window.location.pathname);
  return entry?.path === path ? (entry.layouts?.[surface] ?? null) : null;
}

export function rememberGalleryLayout(
  surface: string,
  layout: 'tiles' | 'full-width'
): void {
  if (
    typeof window === 'undefined' ||
    identityInvalidated ||
    !isApp(window.location.href)
  ) {
    return;
  }
  const key = entryKey();
  if (!key) {
    return;
  }
  const path = normalizeNavPathname(window.location.pathname);
  const previous = positions.get(key);
  const entry = previous?.path === path ? previous : { path };
  storeEntry(key, {
    ...entry,
    layouts: { ...entry.layouts, [surface]: layout },
  });
}

function snapshot(
  key: string | null,
  url: string,
  pending: PendingPosition | null
): void {
  if (!key || !isApp(url)) {
    return;
  }
  const main = document.getElementById('main-content')?.scrollTop ?? 0;
  const unchanged =
    pending?.key === key &&
    Math.abs(pending.lastMain - main) < 3 &&
    Math.abs(pending.lastY - window.scrollY) < 3;
  const path = normalizeNavPathname(
    new URL(url, window.location.href).pathname
  );
  const previous = positions.get(key);
  storeEntry(key, {
    path,
    ...(previous?.path === path && previous.layouts
      ? { layouts: previous.layouts }
      : {}),
    position: unchanged
      ? pending.position
      : { main, x: window.scrollX, y: window.scrollY },
  });
}

export function createHistoryScrollCoordinator(): {
  start: (url: string) => void;
  acceptedPop: () => void;
  complete: (url: string, hashOnly?: boolean) => boolean | null;
  fail: (url: string) => boolean;
  dispose: () => void;
} {
  identityInvalidated = false;
  let currentKey = entryKey();
  let currentUrl = window.location.href;
  let popPending = false;
  let activePop = false;
  let skipReset = false;
  let originPosition: Position | undefined;
  let stopRestore: (() => void) | null = null;
  let pendingPosition: PendingPosition | null = null;
  let pendingUrl: string | null = null;
  const originalRestoration = window.history.scrollRestoration;
  const updateBrowserRestoration = (url: string): void => {
    window.history.scrollRestoration = isApp(url)
      ? 'manual'
      : originalRestoration;
  };
  updateBrowserRestoration(currentUrl);
  const clear = (): void => {
    stopRestore?.();
    stopRestore = null;
    pendingPosition = null;
    currentKey = null;
    pendingUrl = null;
    popPending = false;
    activePop = false;
    skipReset = false;
    originPosition = undefined;
    scrollOption = null;
    positions.clear();
    identityInvalidated = true;
  };
  const handlePageHide = (): void => {
    stopRestore?.();
    stopRestore = null;
    snapshot(currentKey, currentUrl, pendingPosition);
    pendingPosition = null;
  };
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener(AUTH_TOKEN_CLEARED_EVENT, clear);
  window.addEventListener(AUTH_IDENTITY_WILL_CHANGE_EVENT, clear);
  return {
    acceptedPop() {
      stopRestore?.();
      // The browser has changed location but the old screen is still mounted.
      snapshot(currentKey, currentUrl, pendingPosition);
      pendingPosition = null;
      popPending = true;
    },
    start(url) {
      stopRestore?.();
      activePop = popPending;
      popPending = false;
      if (!activePop) {
        snapshot(currentKey, currentUrl, pendingPosition);
      }
      pendingPosition = null;
      pendingUrl = new URL(url, window.location.href).href;
      skipReset =
        scrollOption?.target === normalizeNavPathname(url) &&
        scrollOption.preserve;
      originPosition = currentKey
        ? positions.get(currentKey)?.position
        : undefined;
      scrollOption = null;
    },
    complete(url, hashOnly = false) {
      if (pendingUrl !== new URL(url, window.location.href).href) {
        return null;
      }
      pendingUrl = null;
      const key = entryKey();
      const hasHash = new URL(url, window.location.href).hash.length > 0;
      const entry = key ? positions.get(key) : undefined;
      const saved =
        activePop &&
        isApp(url) &&
        !hasHash &&
        entry?.path ===
          normalizeNavPathname(new URL(url, window.location.href).pathname)
          ? entry.position
          : undefined;
      currentKey = key;
      identityInvalidated = false;
      currentUrl = new URL(url, window.location.href).href;
      updateBrowserRestoration(currentUrl);
      const keep = skipReset || Boolean(saved);
      const targetPosition =
        saved ??
        (!activePop && skipReset && isApp(url) && !hasHash
          ? originPosition
          : undefined);
      activePop = false;
      skipReset = false;
      originPosition = undefined;
      if (targetPosition && !hashOnly) {
        const pending = (): PendingPosition | null =>
          key
            ? {
                key,
                position: targetPosition,
                lastMain:
                  document.getElementById('main-content')?.scrollTop ?? 0,
                lastY: window.scrollY,
              }
            : null;
        pendingPosition = pending();
        stopRestore = restore(
          targetPosition,
          () => {
            pendingPosition = null;
          },
          reached => {
            pendingPosition = reached ? null : pending();
          }
        );
      }
      return keep || hashOnly;
    },
    fail(url) {
      if (pendingUrl !== new URL(url, window.location.href).href) {
        return false;
      }
      pendingUrl = null;
      activePop = false;
      skipReset = false;
      originPosition = undefined;
      return true;
    },
    dispose() {
      clear();
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener(AUTH_TOKEN_CLEARED_EVENT, clear);
      window.removeEventListener(AUTH_IDENTITY_WILL_CHANGE_EVENT, clear);
      window.history.scrollRestoration = originalRestoration;
    },
  };
}

export function useHistoryScrollCoordinator() {
  const ref = useRef<ReturnType<typeof createHistoryScrollCoordinator> | null>(
    null
  );
  useEffect(() => {
    const coordinator = createHistoryScrollCoordinator();
    ref.current = coordinator;
    return () => {
      coordinator.dispose();
      ref.current = null;
    };
  }, []);
  return ref;
}

import { useSyncExternalStore } from 'react';

const subscribeNever = (): (() => void) => () => {};
const getClientSnapshot = (): boolean => true;
const getServerSnapshot = (): boolean => false;

/**
 * False on the server and during the hydration render, true on every later
 * render: the gate for UI that depends on what only the browser knows (a
 * session token in localStorage, the viewport) and must not mismatch the
 * server HTML.
 *
 * DECISION: use this instead of a hand-made `useState(false)` + effect `mounted` gate. That
 * gate starts `false` on EVERY mount, and each public page mounts its own layout, so every
 * client navigation drew the header in its server shape and swapped it a frame later.
 * `useSyncExternalStore` returns the server snapshot only while React hydrates; a component
 * mounted by a later navigation gets `true` on its first render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    getClientSnapshot,
    getServerSnapshot
  );
}

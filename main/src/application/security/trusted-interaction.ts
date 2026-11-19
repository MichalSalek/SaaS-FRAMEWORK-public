/** Shared trusted-input boundary for UI, PII reveal and lazy application messages. */
import { useEffect, useState } from 'react';

const TRUSTED_EVENTS = [
  'pointerdown',
  'pointermove',
  'mousemove',
  'wheel',
  'touchstart',
  'keydown',
  'click',
] as const;

let interacted = false;
let armed = false;
const waiters = new Set<() => void>();

function fireInteraction(e: Event): void {
  if (interacted) {
    return;
  }
  // Only TRUSTED user events. Synthetic ones (dispatchEvent, isTrusted=false) from analytics / GTM
  // / third parties do NOT open the gate.
  if (e.isTrusted !== true) {
    return;
  }
  interacted = true;
  TRUSTED_EVENTS.forEach(ev =>
    window.removeEventListener(ev, fireInteraction, true)
  );
  waiters.forEach(fn => fn());
  waiters.clear();
}

function armListeners(): void {
  if (typeof window === 'undefined' || interacted || armed) {
    return;
  }
  armed = true;
  TRUSTED_EVENTS.forEach(ev =>
    window.addEventListener(ev, fireInteraction, {
      passive: true,
      capture: true,
    })
  );
}

/**
 * Imperative gate read, for hard guards in submit handlers (`if (!hasTrustedInteraction()) return;`)
 * where a hook is not enough: a bot can call the handler despite `disabled` on the button.
 */
export function hasTrustedInteraction(): boolean {
  return interacted;
}

/**
 * Imperative subscription (outside React). Returns an unsubscribe. If the gate is already open the
 * callback runs synchronously, immediately.
 */
export function onTrustedInteraction(cb: () => void): () => void {
  if (interacted) {
    cb();
    return () => undefined;
  }
  armListeners();
  waiters.add(cb);
  return () => {
    waiters.delete(cb);
  };
}

/** false do PIERWSZEJ zaufanej interakcji (ruch / tap / click / wheel / key), potem true. */
export function useTrustedInteraction(): boolean {
  const [trusted, setTrusted] = useState(false);
  useEffect(() => {
    if (interacted) {
      setTrusted(true);
      return;
    }
    armListeners();
    const wake = (): void => setTrusted(true);
    waiters.add(wake);
    return () => {
      waiters.delete(wake);
    };
  }, []);
  return trusted;
}

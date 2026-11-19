import { useEffect, useRef, type RefObject } from 'react';
import {
  applyInert,
  focusInitial,
  type FocusTrapInitialFocus,
} from './focusTrap.dom';

type FocusTrapActivation = {
  active: boolean;
  initialFocus: FocusTrapInitialFocus;
  inert: boolean | 'app-root';
  inertRef: RefObject<HTMLElement | null> | undefined;
};

/**
 * The activation half of useFocusTrap: save focus, move it inside, optionally inert the
 * background, and restore all of it when the trap deactivates.
 */
export function useFocusTrapActivation(
  ref: RefObject<HTMLElement | null>,
  { active, initialFocus, inert, inertRef }: FocusTrapActivation
): void {
  // DECISION: the effect below re-runs on `active` only, on purpose: `initialFocus` and `inert`
  // are per-call-site configuration constants and `ref` / `inertRef` are refs. This file is the
  // one place `react-hooks/exhaustive-deps` is off for it (main/eslint.config.mjs), and
  // 'use no memo' keeps the React Compiler from compiling around the omission.
  'use no memo';
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }
    const container = ref.current;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // Anchor the inert walk from `inertRef` when provided (keeps interactive
    // siblings of the panel — e.g. a separate backdrop — live); else the panel.
    // Fall back to the panel if `inertRef` is momentarily unattached.
    const inertAnchor =
      inert === true && inertRef?.current != null
        ? inertRef.current
        : container;
    const restoreInert = applyInert(inertAnchor, inert);
    const frame = requestAnimationFrame(() => {
      if (ref.current != null) {
        focusInitial(ref.current, initialFocus);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      restoreInert();
      previousFocusRef.current?.focus();
    };
    // `initialFocus` / `inert` are configuration constants per call-site; only
    // `active` toggles the trap, matching the original `[isOpen]`-gated effects.
  }, [active]);
}

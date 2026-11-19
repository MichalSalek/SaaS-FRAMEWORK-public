import { useEffect, type RefObject } from 'react';
import {
  getVisibleFocusable,
  type FocusTrapInitialFocus,
} from './focusTrap.dom';
import { useFocusTrapActivation } from './useFocusTrapActivation';

export type { FocusTrapInitialFocus };

/**
 * Shared focus trap for hand-rolled modals (WCAG 2.4.3 / 4.1.2).
 * One implementation replaced several copies of the same Tab cycle, Escape,
 * and focus save/restore. While `active`, Tab wraps inside `ref`, Escape
 * calls `onEscape`, focus moves in on the next frame and returns on close.
 * `inert` closes the screen-reader gap a keyboard-only trap leaves open.
 */

export interface UseFocusTrapOptions {
  /** When false the trap is inactive (no listeners, no focus management). */
  active: boolean;
  /** Called when Escape is pressed inside the trap. Omit to ignore Escape. */
  onEscape?: (() => void) | undefined;
  /** Initial focus strategy on activate. Default `'container'`. */
  initialFocus?: FocusTrapInitialFocus;
  /**
   * Mark the background as `inert` + aria-hidden while active.
   *  - `false` (default): do nothing.
   *  - `true`: inert everything outside the container's ancestry chain
   *    (use when the modal lives inside the normal DOM tree).
   *  - `'app-root'`: inert the `#__next` app root instead — required when the
   *    modal is portaled to `document.body` (a sibling of the app root), where
   *    walking up from the container would also inert the dialog itself.
   */
  inert?: boolean | 'app-root';
  /**
   * Element to anchor the `inert` background walk from, when it must differ
   * from the focus-trap container. Use when the panel has interactive siblings
   * that must stay live (e.g. a separate backdrop `<div onClick={close}>`):
   * wrap backdrop + panel in a container and pass that container here, so the
   * walk inerts the page behind the wrapper but leaves backdrop + panel
   * interactive. Defaults to the focus-trap `ref`. Ignored unless `inert: true`.
   */
  inertRef?: RefObject<HTMLElement | null>;
}

/**
 * Trap keyboard focus inside `ref` while `active`.
 *
 * @param ref         Ref to the modal container (set `tabIndex={-1}` on it so
 *                    `'container'` / fallback focus works).
 * @param options     See {@link UseFocusTrapOptions}.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  {
    active,
    onEscape,
    initialFocus = 'container',
    inert = false,
    inertRef,
  }: UseFocusTrapOptions
): void {
  // Focus save -> initial focus -> restore, plus optional background inert.
  useFocusTrapActivation(ref, { active, initialFocus, inert, inertRef });

  // Keydown: Escape + Tab cycle.
  useEffect(() => {
    if (!active) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onEscape?.();
        return;
      }
      if (e.key !== 'Tab') {
        return;
      }
      const container = ref.current;
      if (container == null) {
        return;
      }
      const focusable = getVisibleFocusable(container);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first == null || last == null) {
        return;
      }
      // Focus on the container itself (initialFocus 'container', or a click on
      // non-focusable panel content): Shift+Tab from there went to whatever
      // precedes the panel in the DOM, i.e. out of the trap (the browser UI, or
      // the page when the background is not inert).
      if (document.activeElement === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, onEscape, ref]);
}

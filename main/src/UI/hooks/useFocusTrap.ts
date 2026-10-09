import { useEffect, useRef, type RefObject } from 'react';
import { inertBackground } from './inertBackground';

/**
 * Shared focus-trap for hand-rolled modals (WCAG 2.4.3 / 4.1.2 / EAA).
 *
 * Extracted (W1.6) from 5 byte-identical inline copies that each rolled the
 * same Tab-cycle / Escape / focus save-restore logic: AppDrawer, AppBar,
 * GalleryFilterOverlay, UpgradeDialog, DowngradeWarningDialog. One audited
 * implementation now backs all of them.
 *
 * Behaviour (matches the pre-existing copies 1:1):
 *  - While `active`, listens on `document` for keydown.
 *  - Tab / Shift+Tab wrap focus inside `ref` (first <-> last focusable), using
 *    the same focusable selector every copy used.
 *  - Escape calls `onEscape` (when provided).
 *  - On activate: saves `document.activeElement`, then moves focus inside the
 *    container per `initialFocus` (next animation frame, so the panel is laid
 *    out / transitioned in before we focus).
 *  - On deactivate: restores focus to the previously-focused element.
 *  - Optionally marks the background `inert` + aria-hidden while active
 *    (closes the SR virtual-cursor leak a keyboard-only trap leaves open).
 */

// WCAG 2.4.3 / EAA — focusable elements inside a hand-rolled modal. Mirrors the
// selector every inline copy used verbatim, PLUS `iframe`: a cross-origin iframe
// (e.g. the Stripe Payment Element) is a focus boundary — when focus is inside
// it the browser reports the <iframe> as document.activeElement, so it must be in
// the focusable set or the Tab-cycle wrap silently skips it and focus escapes the
// trap. Harmless for iframe-free modals (selector simply matches nothing extra).
const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), iframe, [tabindex]:not([tabindex="-1"])';

// Visible-only focusables. Stripe renders several TECHNICAL iframes (m-outer,
// m.stripe.network metrics/Radar) that are 0-size / display:none — without this
// filter the Tab-cycle first/last could land on a hidden iframe and focus would
// appear to vanish. Keep only elements that actually occupy layout: the visible
// Payment Element iframe stays, the hidden ones drop out. (For non-iframe modals
// the filter is a harmless no-op — normal controls always have layout boxes.)
function getVisibleFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    el =>
      el.offsetWidth > 0 ||
      el.offsetHeight > 0 ||
      el.getClientRects().length > 0
  );
}

/** Where to land focus when the trap activates. */
export type FocusTrapInitialFocus =
  /** Focus the first focusable descendant; fall back to the container. */
  | 'first'
  /** Focus the first focusable descendant; do nothing if there is none. */
  | 'first-only'
  /** Focus the container element itself (must be `tabIndex={-1}`). */
  | 'container'
  /**
   * Resolve a custom element to focus (e.g. a non-first default button).
   * Returning `null` falls back to focusing the container.
   */
  | (() => HTMLElement | null);

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

function focusInitial(
  container: HTMLElement,
  initialFocus: FocusTrapInitialFocus
): void {
  if (typeof initialFocus === 'function') {
    const custom = initialFocus();
    if (custom != null) {
      custom.focus();
    } else {
      container.focus();
    }
    return;
  }
  if (initialFocus === 'container') {
    container.focus();
    return;
  }
  const focusable = getVisibleFocusable(container);
  if (focusable.length > 0) {
    focusable[0]?.focus();
  } else if (initialFocus === 'first') {
    container.focus();
  }
}

function applyInert(
  container: HTMLElement | null,
  inert: boolean | 'app-root'
): () => void {
  if (inert === false) {
    return () => {};
  }
  if (inert === 'app-root') {
    // Inert the fixed app root by id — independent of the panel container (the
    // dialog is portaled to body, a sibling of #__next).
    if (typeof document === 'undefined') {
      return () => {};
    }
    const appRoot = document.getElementById('__next');
    if (appRoot == null) {
      return () => {};
    }
    appRoot.setAttribute('inert', '');
    appRoot.setAttribute('aria-hidden', 'true');
    return () => {
      appRoot.removeAttribute('inert');
      appRoot.removeAttribute('aria-hidden');
    };
  }
  // inert === true: walk up from the container's DOM chain.
  if (container == null) {
    return () => {};
  }
  return inertBackground(container);
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
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus save -> initial focus -> restore, plus optional background inert.
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
    // React Compiler safely skips this hook (load-bearing exhaustive-deps opt-out,
    // config constants gated on `active` only — not a bug).
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

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

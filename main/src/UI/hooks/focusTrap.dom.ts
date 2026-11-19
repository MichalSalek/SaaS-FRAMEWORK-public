import { inertBackground } from './inertBackground';

// DOM helpers of the focus trap (useFocusTrap.ts), shared by its activation hook
// (useFocusTrapActivation.ts) and its keydown cycle.

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
export function getVisibleFocusable(container: HTMLElement): HTMLElement[] {
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

export function focusInitial(
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

export function applyInert(
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

// UI/hooks/useSwipeDismiss.ts
// Native-feeling "swipe to dismiss" for every sheet and drawer: the panel follows
// the finger, a flick or a long enough drag closes it, anything else springs back.
//
// DECISION (nie usuwaj tego komentarza):
//  • ONE gesture implementation for the whole product. Before S122 only the nav
//    drawer had a swipe (80 px threshold, no velocity, snapped instead of
//    following through), every other sheet had none. Sheets, drawers and the
//    mobile dialog all attach this hook; do not hand-roll pointer math again.
//  • Pointer events + inline transform on the panel, NOT React state: 60 moves a
//    second through setState would re-render the whole sheet content.
//  • AXIS LOCK before anything moves. The gesture starts only after the finger
//    travelled LOCK_DISTANCE_PX and the dominant axis points toward the dismiss
//    edge; otherwise the browser keeps the touch (vertical scroll inside a side
//    sheet, horizontal carousels inside a bottom sheet).
//  • Touch and pen only by default: a mouse drag on desktop is text selection,
//    and desktop has the close button, ESC and the backdrop.
//  • Form fields, contenteditable and `[data-swipe-ignore]` never start a swipe;
//    neither does a horizontally scrollable child for a horizontal swipe, nor a
//    scrolled-down content area for a downward swipe (content scroll wins).
//  • Dismiss hands the panel to the component's own exit: we keep animating the
//    inline transform off-screen and call `onDismiss` right away, so Base UI's
//    `data-ending-style` waits for our running transition instead of snapping.
//  • No `prefers-reduced-motion` branch (project rule, DESIGN.md).

import { useEffect, useRef, type RefObject } from 'react';
import { hapticImpact } from '../../application/platform/haptics';

export type SwipeDismissDirection = 'left' | 'right' | 'down';

export interface UseSwipeDismissOptions {
  /** The element that moves with the finger (the sheet / drawer panel). */
  targetRef: RefObject<HTMLElement | null>;
  /** Edge the panel leaves through when dismissed. */
  direction: SwipeDismissDirection;
  /** Called once when the gesture decides to close. */
  onDismiss: () => void;
  /** Gesture only starts inside this element (a handle or header). Default: the target. */
  handleRef?: RefObject<HTMLElement | null>;
  /** Optional backdrop faded in step with the drag. */
  backdropRef?: RefObject<HTMLElement | null>;
  /** Accept mouse drags as well (default false: touch and pen only). */
  allowMouse?: boolean;
  enabled?: boolean;
  /** Checked at every touch start, e.g. "only while the dialog is full-screen". */
  shouldStart?: () => boolean;
}

/** Travel before the axis is decided (px). */
const LOCK_DISTANCE_PX = 8;
/** Share of the panel size that closes on release without a flick. */
const DISMISS_FRACTION = 0.3;
/** Floor for the distance threshold on small panels (px). */
const MIN_DISMISS_DISTANCE_PX = 72;
/** Release velocity that closes regardless of distance (px/ms). */
const FLICK_VELOCITY = 0.45;
/** A flick still needs a little travel, so a tap-jitter never closes (px). */
const MIN_FLICK_DISTANCE_PX = 24;
/** Duration of the settle / exit animation (ms) — matches --duration-300. */
const SETTLE_MS = 300;
const SETTLE_CURVE = 'var(--ios-sheet-curve)';

const IGNORE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-swipe-ignore]';

const isHorizontal = (direction: SwipeDismissDirection): boolean =>
  direction === 'left' || direction === 'right';

/** Signed travel toward the dismiss edge (positive = toward closing). */
const towardDismiss = (
  direction: SwipeDismissDirection,
  dx: number,
  dy: number
): number => {
  if (direction === 'left') {
    return -dx;
  }
  if (direction === 'right') {
    return dx;
  }
  return dy;
};

const translateFor = (direction: SwipeDismissDirection, px: number): string => {
  if (direction === 'left') {
    return `translate3d(${-px}px, 0, 0)`;
  }
  if (direction === 'right') {
    return `translate3d(${px}px, 0, 0)`;
  }
  return `translate3d(0, ${px}px, 0)`;
};

const offscreenFor = (direction: SwipeDismissDirection): string => {
  if (direction === 'left') {
    return 'translate3d(-100%, 0, 0)';
  }
  if (direction === 'right') {
    return 'translate3d(100%, 0, 0)';
  }
  return 'translate3d(0, 100%, 0)';
};

/** Walks from `start` up to `boundary` looking for something that owns the scroll. */
const blocksGesture = (
  start: Element,
  boundary: Element,
  direction: SwipeDismissDirection
): boolean => {
  if (start.closest(IGNORE_SELECTOR)) {
    return true;
  }
  let node: Element | null = start;
  while (node && node !== boundary.parentElement) {
    if (node instanceof HTMLElement) {
      const style = window.getComputedStyle(node);
      if (isHorizontal(direction)) {
        const scrollsX =
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          node.scrollWidth > node.clientWidth + 1;
        if (scrollsX) {
          return true;
        }
      } else {
        const scrollsY =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 1;
        if (scrollsY && node.scrollTop > 0) {
          return true;
        }
      }
    }
    if (node === boundary) {
      break;
    }
    node = node.parentElement;
  }
  return false;
};

/**
 * Imperative core of the gesture (plain function, not a hook): binds pointer
 * listeners to `handle`, moves `target` with inline transforms and returns the
 * cleanup. Kept outside the hook on purpose: it writes DOM styles of elements
 * the caller owns, which React Compiler forbids inside a hook body.
 */
export function attachSwipeDismiss(
  target: HTMLElement,
  handle: HTMLElement,
  backdrop: HTMLElement | null,
  direction: SwipeDismissDirection,
  allowMouse: boolean,
  callbacks: { onDismiss: () => void; shouldStart?: () => boolean }
): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let locked = false;
  let travelled = 0;
  let size = 1;
  let samples: { t: number; d: number }[] = [];
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearInline = () => {
    target.style.transform = '';
    target.style.transition = '';
    if (backdrop) {
      backdrop.style.opacity = '';
      backdrop.style.transition = '';
    }
  };

  const reset = () => {
    pointerId = null;
    locked = false;
    travelled = 0;
    samples = [];
  };

  const suppressNextClick = () => {
    const stop = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    // If no click follows (touch without a synthesized click), drop the trap
    // before a real, later tap could be swallowed.
    setTimeout(() => window.removeEventListener('click', stop, true), 350);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null || event.button !== 0) {
      return;
    }
    if (event.pointerType === 'mouse' && !allowMouse) {
      return;
    }
    if (callbacks.shouldStart !== undefined && !callbacks.shouldStart()) {
      return;
    }
    const origin = event.target;
    if (
      !(origin instanceof Element) ||
      blocksGesture(origin, handle, direction)
    ) {
      return;
    }
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
      clearInline();
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    const rect = target.getBoundingClientRect();
    size = Math.max(1, isHorizontal(direction) ? rect.width : rect.height);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!locked) {
      if (Math.hypot(dx, dy) < LOCK_DISTANCE_PX) {
        return;
      }
      const alongAxis = isHorizontal(direction) ? Math.abs(dx) : Math.abs(dy);
      const acrossAxis = isHorizontal(direction) ? Math.abs(dy) : Math.abs(dx);
      if (alongAxis <= acrossAxis || towardDismiss(direction, dx, dy) <= 0) {
        // Not our gesture — leave the touch to the browser (scroll).
        reset();
        return;
      }
      locked = true;
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already released — the next move will reset.
      }
      target.style.transition = 'none';
      if (backdrop) {
        backdrop.style.transition = 'none';
      }
    }
    travelled = Math.max(0, towardDismiss(direction, dx, dy));
    target.style.transform = translateFor(direction, travelled);
    if (backdrop) {
      backdrop.style.opacity = String(Math.max(0, 1 - travelled / size));
    }
    samples.push({ t: event.timeStamp, d: travelled });
    if (samples.length > 6) {
      samples.shift();
    }
    event.preventDefault();
  };

  const finish = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) {
      return;
    }
    if (!locked) {
      reset();
      return;
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    const velocity =
      first !== undefined && last !== undefined && last.t > first.t
        ? (last.d - first.d) / (last.t - first.t)
        : 0;
    const distanceThreshold = Math.max(
      MIN_DISMISS_DISTANCE_PX,
      size * DISMISS_FRACTION
    );
    const shouldDismiss =
      event.type !== 'pointercancel' &&
      (travelled >= distanceThreshold ||
        (velocity >= FLICK_VELOCITY && travelled >= MIN_FLICK_DISTANCE_PX));

    target.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_CURVE}`;
    if (backdrop) {
      backdrop.style.transition = `opacity ${SETTLE_MS}ms ${SETTLE_CURVE}`;
    }
    // DECISION (nie usuwaj tego komentarza): `onDismiss` runs BEFORE the
    // click trap is armed. AppDialog closes by clicking its hidden
    // Dialog.Close (the same channel as the close button), and a synchronous
    // `.click()` issued after `suppressNextClick()` was swallowed by the
    // capture listener: the dialog never closed, the panel slid off-screen
    // and snapped back after the settle timer, and the real click the touch
    // synthesises afterwards was no longer suppressed.
    if (shouldDismiss) {
      target.style.transform = offscreenFor(direction);
      if (backdrop) {
        backdrop.style.opacity = '0';
      }
      void hapticImpact('Light');
      callbacks.onDismiss();
    }
    // A small drift during a tap (just past the axis lock) must stay a tap:
    // only a real drag or a dismiss swallows the click that follows.
    if (shouldDismiss || travelled >= MIN_FLICK_DISTANCE_PX) {
      suppressNextClick();
    }
    if (!shouldDismiss) {
      target.style.transform = '';
      if (backdrop) {
        backdrop.style.opacity = '';
      }
    }
    settleTimer = setTimeout(() => {
      settleTimer = null;
      // After a dismiss the element is usually unmounted already; if it is a
      // persistent drawer, its closed CSS state equals the off-screen value.
      clearInline();
    }, SETTLE_MS + 40);
    reset();
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  // Horizontal swipes keep vertical scrolling native; a downward swipe owns
  // its handle completely (the handle is a header, not the scroll area).
  const previousTouchAction = handle.style.touchAction;
  handle.style.touchAction = isHorizontal(direction) ? 'pan-y' : 'none';

  return () => {
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', finish);
    handle.removeEventListener('pointercancel', finish);
    handle.style.touchAction = previousTouchAction;
    // DECISION (nie usuwaj tego komentarza): a pending settle timer is NOT
    // cancelled here. A dismiss flips `enabled` off in the same turn, so this
    // cleanup runs inside the settle window; cancelling the timer left a
    // persistent panel (nav drawer, gallery filter sheet) with an inline
    // off-screen transform and a 0-opacity scrim, and the next open showed
    // nothing while scroll lock and the focus trap were already active. The
    // timer only clears inline styles, harmless on a detached element. It is
    // not restarted either: a fresh full-length timer outlived the original
    // settle, kept a quickly re-opened drawer parked off-screen longer, and
    // could wipe the inline transform of a drag the next attach had started.
  };
}

/**
 * Attach from a component that mounts TOGETHER with the panel (e.g. a child of
 * a Base UI `Dialog.Popup`): listeners bind in an effect that reads the refs
 * once, so the elements must already exist when that effect runs.
 */
export function useSwipeDismiss({
  targetRef,
  direction,
  onDismiss,
  handleRef,
  backdropRef,
  allowMouse = false,
  enabled = true,
  shouldStart,
}: UseSwipeDismissOptions): void {
  // Latest callbacks without re-binding listeners on every render.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const shouldStartRef = useRef(shouldStart);
  shouldStartRef.current = shouldStart;

  useEffect(() => {
    const target = targetRef.current;
    const handle = handleRef?.current ?? target;
    if (!enabled || !target || !handle) {
      return;
    }
    return attachSwipeDismiss(
      target,
      handle,
      backdropRef?.current ?? null,
      direction,
      allowMouse,
      {
        onDismiss: () => onDismissRef.current(),
        shouldStart: () => shouldStartRef.current?.() ?? true,
      }
    );
  }, [targetRef, handleRef, backdropRef, direction, allowMouse, enabled]);
}

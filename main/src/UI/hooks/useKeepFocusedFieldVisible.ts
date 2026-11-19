import { useEffect } from 'react';

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
]);

function isEditable(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement) || element.matches(':disabled')) {
    return false;
  }
  if (element instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(element.type) && !element.readOnly;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly;
  }
  return element.isContentEditable;
}

function scrollPadding(value: string, height: number): number {
  if (value.endsWith('%')) {
    return (Number.parseFloat(value) * height) / 100 || 0;
  }
  return Number.parseFloat(value) || 0;
}

/** Keep a focused editor visible without scrolling the page or changing focus. */
export function useKeepFocusedFieldVisible(
  container: HTMLElement | null
): void {
  useEffect(() => {
    if (!container) {
      return;
    }
    const visualViewport = window.visualViewport;
    let frame: number | null = null;
    let disposed = false;

    const reveal = () => {
      frame = null;
      const active = document.activeElement;
      if (!active || !container.contains(active) || !isEditable(active)) {
        return;
      }
      const activeDialog = active.closest('dialog, [role="dialog"]');
      if (activeDialog !== container.closest('dialog, [role="dialog"]')) {
        return;
      }
      const style = getComputedStyle(container);
      if (
        style.overflowY === 'hidden' ||
        style.overflowY === 'clip' ||
        container.scrollHeight <= container.clientHeight
      ) {
        return;
      }

      const bounds = container.getBoundingClientRect();
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom =
        viewportTop + (visualViewport?.height ?? window.innerHeight);
      const top =
        Math.max(bounds.top, viewportTop) +
        scrollPadding(style.scrollPaddingTop, container.clientHeight);
      const bottom =
        Math.min(bounds.bottom, viewportBottom) -
        scrollPadding(style.scrollPaddingBottom, container.clientHeight);
      const field = active.getBoundingClientRect();
      if (bottom <= top || field.height > bottom - top) {
        return;
      }
      const delta =
        field.top < top
          ? field.top - top
          : field.bottom > bottom
            ? field.bottom - bottom
            : 0;
      const target = Math.max(
        0,
        Math.min(
          container.scrollTop + delta,
          container.scrollHeight - container.clientHeight
        )
      );
      const actualDelta = target - container.scrollTop;
      if (Math.abs(actualDelta) > 0.5) {
        container.scrollBy({ top: actualDelta, behavior: 'instant' });
      }
    };
    const schedule = () => {
      if (!disposed && frame === null) {
        frame = requestAnimationFrame(reveal);
      }
    };

    container.addEventListener('focusin', schedule);
    window.addEventListener('resize', schedule);
    visualViewport?.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(container);
    schedule();

    return () => {
      disposed = true;
      container.removeEventListener('focusin', schedule);
      window.removeEventListener('resize', schedule);
      visualViewport?.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [container]);
}

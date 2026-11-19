// Frame-driven scrolling keeps the same easing and duration across browsers.
// Intermediate positions use behavior:auto so each frame moves directly to its target.

const DEFAULT_DURATION_MS = 520;

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Smooth window scroll to an absolute Y position (px in the document). */
export function smoothScrollToY(
  targetY: number,
  durationMs = DEFAULT_DURATION_MS
): void {
  const startY = window.scrollY;
  const delta = targetY - startY;
  if (Math.abs(delta) < 2) {
    return;
  }
  let startTs: number | null = null;
  const step = (ts: number): void => {
    startTs ??= ts;
    const progress = Math.min((ts - startTs) / durationMs, 1);
    window.scrollTo({
      top: startY + delta * easeInOutCubic(progress),
      behavior: 'auto',
    });
    if (progress < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

/**
 * Smooth scroll to an element with a top offset (fixed navbar / scroll-margin).
 * @param offsetTop px subtracted from the element position (e.g. 96 = navbar height).
 */
export function smoothScrollToElement(el: HTMLElement, offsetTop = 0): void {
  const targetY = el.getBoundingClientRect().top + window.scrollY - offsetTop;
  smoothScrollToY(targetY);
}

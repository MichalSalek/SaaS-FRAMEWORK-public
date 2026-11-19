/** Animate the existing node so a live region receives one content update. */
export function animateOutcomeChange(
  element: HTMLElement | null
): Animation | undefined {
  if (element === null || typeof element.animate !== 'function') {
    return undefined;
  }
  const duration = Number.parseFloat(
    getComputedStyle(element).getPropertyValue('--outcome-change-duration')
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    return undefined;
  }
  return element.animate([{ opacity: 0.65 }, { opacity: 1 }], {
    duration,
    easing: 'ease',
  });
}

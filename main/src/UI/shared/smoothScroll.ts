// main/src/UI/shared/smoothScroll.ts
//
// rAF-driven smooth scroll, IGNORUJĄCY systemowy prefers-reduced-motion.
//
// DLACZEGO ISTNIEJE (owner S81, powtórka S82): przeglądarki bramkują CSS
// `scroll-behavior:smooth` ORAZ natywne `scrollTo({behavior:'smooth'})` na
// systemowej preferencji „reduce motion" — user z tym ustawieniem widzi skok
// (instant), mimo że CSS-owe animacje/transitions (np. shimmer) działają dalej.
// To sprzeczne z doktryną projektu „animacje bezwarunkowo" (owner usunął
// prefers-reduced-motion z całego kodu, decyzja 2026-05-28). Ręczna pętla rAF
// nie pyta o preferencję → smooth zawsze. Każda klatka używa `behavior:'auto'`,
// żeby NIE kolidować z globalnym `html{scroll-behavior:smooth}` (inaczej każdy
// krok pośredni sam próbowałby się smooth-scrollować → jank).

const DEFAULT_DURATION_MS = 520;

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Płynny scroll okna do absolutnej pozycji Y (px w dokumencie). */
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
 * Płynny scroll do elementu z offsetem górnym (fixed navbar / scroll-margin).
 * @param offsetTop px odejmowane od pozycji elementu (np. 96 = wysokość navbara).
 */
export function smoothScrollToElement(el: HTMLElement, offsetTop = 0): void {
  const targetY = el.getBoundingClientRect().top + window.scrollY - offsetTop;
  smoothScrollToY(targetY);
}

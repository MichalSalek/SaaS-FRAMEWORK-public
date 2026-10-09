/**
 * Mark everything outside `el`'s ancestry chain as `inert` (+ aria-hidden), so
 * screen-reader virtual cursors / iOS rotor cannot reach background content
 * while a fullscreen hand-rolled modal is open. WCAG 2.4.3 / 4.1.2: a Tab
 * focus-trap handles the keyboard, this closes the SR-leak gap trapping alone
 * leaves open.
 *
 * Walks up from `el` to <body>, setting `inert` on each ancestor's *other*
 * children — leaving the overlay's own chain interactive. Returns a cleanup
 * that restores the prior inert/aria-hidden state. No portal required.
 *
 * Shared helper (extracted from GalleryFilterOverlay, S14) so hand-rolled
 * modals lacking Base UI's automatic background inert can reuse one audited
 * implementation instead of each rolling its own.
 */
export function inertBackground(el: HTMLElement | null): () => void {
  if (el == null || typeof document === 'undefined') {
    return () => {};
  }
  const touched: {
    node: HTMLElement;
    hadInert: boolean;
    ariaPrev: string | null;
  }[] = [];
  let node: HTMLElement | null = el;
  while (node !== null && node.parentElement !== null) {
    const parent: HTMLElement = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement)) {
        continue;
      }
      touched.push({
        node: sibling,
        hadInert: sibling.inert,
        ariaPrev: sibling.getAttribute('aria-hidden'),
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
    node = parent;
  }
  return () => {
    for (const { node: n, hadInert, ariaPrev } of touched) {
      n.inert = hadInert;
      if (ariaPrev === null) {
        n.removeAttribute('aria-hidden');
      } else {
        n.setAttribute('aria-hidden', ariaPrev);
      }
    }
  };
}

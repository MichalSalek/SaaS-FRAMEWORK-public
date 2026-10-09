// admin/hooks/useRevealEditor.ts
// Master and detail on one page (notes, policies): on a phone the list sits
// under the editor, so a pick there would change an editor that is off
// screen. `reveal` brings the editor back only when its top is not visible;
// on a wide page, where both stand side by side, it does nothing.

import { useCallback, useRef } from 'react';

/** Share of the viewport height the editor's top may sit below and still count as visible. */
const VISIBLE_BAND = 0.6;

export function useRevealEditor() {
  const anchorRef = useRef<HTMLDivElement>(null);

  const reveal = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor === null) {
      return;
    }
    const { top } = anchor.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight * VISIBLE_BAND) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return { anchorRef, reveal };
}

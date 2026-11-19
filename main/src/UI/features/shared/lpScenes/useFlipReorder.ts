// UI/features/shared/lpScenes/useFlipReorder.ts
// Children of a grid that change ORDER glide to their new cells instead of
// jumping (first, last, invert, play). Positions are read relative to the
// container (`offsetLeft` / `offsetTop`), so a scroll between two renders
// does not skew the distance. The moving element carries its own transition
// in CSS; the hook only cancels it for the one frame of the inverted start.

import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Cell {
  left: number;
  top: number;
}

export function useFlipReorder(
  containerRef: RefObject<HTMLElement | null>,
  orderKey: string
): void {
  const previous = useRef<Map<string, Cell>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>('[data-flip-id]')
    );
    const next = new Map<string, Cell>();
    for (const node of nodes) {
      const id = node.dataset['flipId'];
      if (id !== undefined) {
        next.set(id, { left: node.offsetLeft, top: node.offsetTop });
      }
    }
    const moved: HTMLElement[] = [];
    for (const node of nodes) {
      const id = node.dataset['flipId'];
      const before = id === undefined ? undefined : previous.current.get(id);
      const after = id === undefined ? undefined : next.get(id);
      if (!before || !after) {
        continue;
      }
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) {
        continue;
      }
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(node);
    }
    previous.current = next;
    if (moved.length === 0) {
      return;
    }
    // Two frames: the first paints the inverted start, the second lets the
    // CSS transition carry every tile home.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        for (const node of moved) {
          node.style.transition = '';
          node.style.transform = '';
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      for (const node of moved) {
        node.style.transition = '';
        node.style.transform = '';
      }
    };
  }, [containerRef, orderKey]);
}

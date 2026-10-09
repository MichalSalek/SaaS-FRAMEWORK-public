// UI/components/PageColumns/PageColumns.molecule.tsx
// The one two-column scaffold of app screens: what the person DOES in the main
// column, what she READS in the aside.
//
// DECISION (nie usuwaj tego komentarza) — owner 2026-10-08: „wykorzystaj
// szerokość” between tablet and desktop. Until S126 every app screen was one
// column at any width: at 1024px rows were 930px wide, a card's arrow sat
// 900px from its text and a two-line empty state filled the whole screen.
// The split follows the scaffold's OWN width (container query), never the
// viewport: app routes also render inside a 390px phone frame on a wide
// desktop, where a viewport breakpoint lies. Below 720px of own width it is
// one column, main first, so nothing changes on a phone. The aside is NOT
// sticky (owner: nothing floats with the scroll).

import type { ReactNode } from 'react';
import styles from './PageColumns.module.css';

export interface PageColumnsProps {
  /** The doing column: waiting items, the main action, the list being worked. */
  main: ReactNode;
  /** The reading column: numbers, links to share, notes. Below the split it
   *  flows under `main`. Omitted or null: `main` keeps a readable measure. */
  aside?: ReactNode;
  /** `'wide'` gives the aside more room (a QR card, a form). */
  asideSize?: 'regular' | 'wide';
  /**
   * Order in ONE column (below the split). Default: `main` first. `'aside'`
   * puts the aside on top there, for a screen whose aside is what a phone must
   * show first (the QR to scan) while the list is the main column on a tablet.
   */
  narrowFirst?: 'main' | 'aside';
}

export function PageColumnsMolecule({
  main,
  aside,
  asideSize = 'regular',
  narrowFirst = 'main',
}: PageColumnsProps) {
  const hasAside = aside !== undefined && aside !== null && aside !== false;
  return (
    <div className={styles.frame}>
      <div
        className={styles.columns}
        data-aside={hasAside ? asideSize : 'none'}
        data-narrow-first={narrowFirst}>
        <div className={styles.main}>{main}</div>
        {hasAside && <div className={styles.aside}>{aside}</div>}
      </div>
    </div>
  );
}

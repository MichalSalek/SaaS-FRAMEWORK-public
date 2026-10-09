import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Eyebrow.module.css';

export type EyebrowVariant = 'plain' | 'chip';
type EyebrowElement = 'span' | 'p' | 'div' | 'h1' | 'h2' | 'h3';

export interface EyebrowProps {
  children: ReactNode;
  variant?: EyebrowVariant;
  as?: EyebrowElement;
  className?: string;
}

/**
 * Canonical eyebrow / kicker primitive — uppercase, tracked label that sits
 * above a section headline.
 *
 * variant="plain"  — bare uppercase text, no dot, no background.
 * variant="chip"   — tracked caps w accent-fg (AA-safe) z hairline
 *                    PODKREŚLENIEM (S82 głos D; wiodąca kreska odeszła jako
 *                    „trąci AI"), BEZ pudełka/dot. Wraps gracefully for long
 *                    SEO phrases. Wygląd idzie z tokenów `--style-label-*` i
 *                    `--style-eyebrow-rule` (tokens.css), więc głos S105/4
 *                    nad stylem kickera zmienia go w jednym miejscu. Pełna
 *                    spec w Eyebrow.module.css §chip.
 *
 * Single source for hero eyebrows, section kickers, and stat labels.
 *
 * DECISION (nie usuwaj tego komentarza): chip ewoluował z frozen-box (S23/1)
 * do rule+caps (owner S28/1 = C) — pudełko było "ciężki szum" i rozciągało się
 * we flex-kolumnie; kropka "wygląda jak status czegoś". Brak dotu/solid-fill/
 * box jest celowy. Kolor tekstu = accent-fg (NIGDY --color-primary = FAIL AA
 * jako tekst). Nie przywracać boxa/dotu bez świadomej decyzji designu.
 */
export function EyebrowAtom({
  children,
  variant = 'plain',
  as: Tag = 'span',
  className,
}: EyebrowProps) {
  return (
    <Tag className={clsx(styles.eyebrow, styles[variant], className)}>
      <span className={styles.text}>{children}</span>
    </Tag>
  );
}

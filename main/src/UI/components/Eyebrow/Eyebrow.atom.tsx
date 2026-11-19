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
 * Canonical eyebrow / kicker: a small label above a section headline, the single source for
 * hero eyebrows, section kickers and stat labels. "plain" = bare text; "chip" = accent-fg text
 * (AA-safe) with an underline hairline, no box, no dot. Look comes from the `--style-kicker-*`
 * and `--style-eyebrow-rule` tokens (tokens.css); full spec in Eyebrow.module.css §chip.
 *
 * DECISION: no box and no dot on the chip (owner): the box was heavy noise and stretched in a flex
 * column, a dot reads as a status. Text color is accent-fg, never --color-primary (fails AA as text).
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

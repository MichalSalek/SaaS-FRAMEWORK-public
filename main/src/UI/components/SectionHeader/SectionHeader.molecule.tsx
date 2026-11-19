import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './SectionHeader.module.css';

type SectionHeaderAlign = 'start' | 'center';

export interface SectionHeaderProps {
  title?: ReactNode;
  /** id for the <h2>, so a section can wire aria-labelledby to it. */
  titleId?: string;
  align?: SectionHeaderAlign;
  className?: string;
  /** Lede / supporting copy rendered under the title. */
  children?: ReactNode;
}

/**
 * Canonical section header — headline <h2> plus optional supporting copy in a
 * consistent vertical stack. Replaces duplicated section heading structures.
 *
 * Pages customize typography, headline/lede colors, and hyphenation through
 * CSS variable hooks on `className`. The whole title uses one foreground color;
 * ReactNode content must not introduce a decorative colored keyword.
 */
export function SectionHeaderMolecule({
  title,
  titleId,
  align = 'start',
  className,
  children,
}: SectionHeaderProps) {
  return (
    <div className={clsx(styles.header, styles[align], className)}>
      {title != null && (
        <h2 id={titleId} className={styles.title} data-app-section-title=''>
          {title}
        </h2>
      )}
      {children != null && <div className={styles.lede}>{children}</div>}
    </div>
  );
}

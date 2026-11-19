import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './FeatureCardGrid.module.css';

type FeatureCardColumns = 2 | 3 | 4;

export interface FeatureCardGridProps {
  /** Desktop column count (mobile always 1, tablet 2). Default 3. */
  columns?: FeatureCardColumns;
  children: ReactNode;
  className?: string;
}

/**
 * FeatureCardGrid — an even, responsive grid of FeatureCard/NavCard (mobile 1,
 * tablet 2, desktop `columns`). Do NOT use it for asymmetric or bento layouts
 * (ForClients visitMoments): there the layout is section mechanics, not a grid.
 */
export function FeatureCardGridMolecule({
  columns = 3,
  children,
  className,
}: FeatureCardGridProps) {
  return (
    <div
      className={clsx(styles.grid, styles[`cols${columns}`], className)}
      data-columns={columns}>
      {children}
    </div>
  );
}

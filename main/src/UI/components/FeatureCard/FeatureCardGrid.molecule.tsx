import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './FeatureCardGrid.module.css';

type FeatureCardColumns = 2 | 3 | 4;

export interface FeatureCardGridProps {
  /** Liczba kolumn na desktop (mobile zawsze 1, tablet 2). Default 3. */
  columns?: FeatureCardColumns;
  children: ReactNode;
  className?: string;
}

/**
 * FeatureCardGrid — równa, responsywna siatka FeatureCard/NavCard (mobile 1 →
 * tablet 2 → desktop `columns`). Równość kart = jakość (Style Policy); do
 * asymetrycznych/bento układów (ForClients visitMoments) NIE używać — tam
 * layout jest sekcyjną mechaniką, nie siatką kart.
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

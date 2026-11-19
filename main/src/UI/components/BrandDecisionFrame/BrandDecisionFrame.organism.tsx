import type { ReactNode } from 'react';
import clsx from 'clsx';
import styles from './BrandDecisionFrame.module.css';

export interface BrandDecisionFrameProps {
  as?: 'main' | 'div';
  variant?: 'welcome' | 'decision';
  intro: ReactNode;
  children: ReactNode;
}

/** The owner-approved welcome composition, shared with plan decisions. */
export function BrandDecisionFrameOrganism({
  as: Element = 'div',
  variant = 'decision',
  intro,
  children,
}: BrandDecisionFrameProps) {
  return (
    <Element className={clsx(styles.screen, styles[variant])}>
      <div className={styles.field}>{intro}</div>
      <div className={styles.plinth}>{children}</div>
    </Element>
  );
}

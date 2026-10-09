import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';
import styles from './AlignedPricingFeatureList.module.css';

interface AlignedPricingFeatureListItem {
  id: string;
  content: ReactNode;
}

interface AlignedPricingFeatureListProps {
  items: readonly AlignedPricingFeatureListItem[];
  rowCount: number;
  className?: string;
  itemClassName?: string;
  leadingSpacerRows?: number;
}

export function AlignedPricingFeatureListMolecule({
  items,
  rowCount,
  className,
  itemClassName,
  leadingSpacerRows = 0,
}: AlignedPricingFeatureListProps) {
  const trailingSpacerRows = Math.max(
    0,
    rowCount - leadingSpacerRows - items.length
  );
  const style = {
    '--pricing-feature-row-count': rowCount,
  } as CSSProperties;

  return (
    <ul
      className={clsx(styles.featureList, className)}
      style={style}
      data-pricing-feature-list>
      {Array.from({ length: leadingSpacerRows }, (_, index) => (
        <li
          key={`leading-spacer-${index}`}
          className={clsx(styles.featureItem, itemClassName)}
          aria-hidden='true'
          data-pricing-feature-spacer
        />
      ))}
      {items.map(item => (
        <li key={item.id} className={clsx(styles.featureItem, itemClassName)}>
          {item.content}
        </li>
      ))}
      {Array.from({ length: trailingSpacerRows }, (_, index) => (
        <li
          key={`trailing-spacer-${index}`}
          className={clsx(styles.featureItem, itemClassName)}
          aria-hidden='true'
          data-pricing-feature-spacer
        />
      ))}
    </ul>
  );
}

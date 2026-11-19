import { ArrowRightIcon } from '@phosphor-icons/react';
import styles from './AffordanceDisc.module.css';

/**
 * Clickability sign: a red arrow in a disc on a clickable row or card.
 *
 * DECISION: clickability is carried by a pair, the white surface (`--color-surface-interactive`)
 * and this sign; information gets neither. The disc is decoration (aria-hidden): the link or
 * button it sits in carries the name and role. (owner)
 */
export function AffordanceDiscAtom({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={`${styles.disc}${className ? ` ${className}` : ''}`}
      data-size={size}
      aria-hidden='true'>
      <ArrowRightIcon size={size === 'sm' ? 14 : 16} weight='bold' />
    </span>
  );
}

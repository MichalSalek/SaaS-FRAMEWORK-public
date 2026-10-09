import { ArrowRightIcon } from '@phosphor-icons/react';
import styles from './AffordanceDisc.module.css';

/**
 * Znak klikalności: czerwona strzałka w kółku na klikalnym wierszu lub karcie.
 *
 * DECISION (nie usuwaj tego komentarza) — głos ownera S116 „A3 · Biel na
 * papierze” (2026-09-15): „sekcje z interaktywnością muszą się wyróżniać na
 * widokach zawsze”. Klikalność niesie para: biała powierzchnia
 * (`--color-surface-interactive`) i ten znak. Informacja nie dostaje ani
 * jednego, ani drugiego. Znak jest dekoracją (aria-hidden): nazwę i rolę
 * niesie sam link lub przycisk, w którym stoi.
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

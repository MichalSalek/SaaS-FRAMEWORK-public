import clsx from 'clsx';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { BrandMarkAtom } from '../BrandMark/BrandMark.atom';
import styles from './BrandLockup.module.css';

export interface BrandLockupMoleculeProps {
  /** Class for the whole lockup (the wordmark font size is inherited as `em` by the mark). */
  className?: string;
  /** Mark size override, when the parent does not drive the lockup font-size. */
  markClassName?: string;
  wordmarkClassName?: string;
}

/**
 * BrandLockupMolecule: SSOT of the mark + „Nailfolio" wordmark pair.
 *
 * The navbar, account rail, admin rail, login, welcome and maintenance render the brand in the
 * SAME form: heading font beside the nf mark, NEVER a pill/chip. The mark alone (footer, a screen
 * without the name) stays on BrandMarkAtom.
 *
 * DECISION: the name in the lockup is the same thing as in a heading (Marcellus), never an
 * uppercase pill on the next line: a chip with the brand name under the logo is AI slop. A
 * chip/badge stays ONLY when it encodes a state, a filter or a count. (owner)
 */
export function BrandLockupMolecule({
  className,
  markClassName,
  wordmarkClassName,
}: BrandLockupMoleculeProps) {
  return (
    <span className={clsx(styles.lockup, className)}>
      <BrandMarkAtom className={clsx(styles.mark, markClassName)} />
      <span className={clsx(styles.wordmark, wordmarkClassName)}>
        {BRAND_CONFIG.name}
      </span>
    </span>
  );
}

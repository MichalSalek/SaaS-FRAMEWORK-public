import { useState } from 'react';
import { PhoneMockupMolecule } from '../PhoneMockup/PhoneMockup.molecule';
import type { PhoneStageScreen } from '../InteractivePhoneStage/InteractivePhoneStage.organism';
import styles from './InteractivePhoneDuo.module.css';

export interface InteractivePhoneDuoProps {
  /** Exactly 2 screens (1 focal + 1 side). */
  screens: readonly [PhoneStageScreen, PhoneStageScreen];
  /** aria-label of the group (landmark region). */
  ariaLabel?: string;
  /** Which screen starts enlarged (default: the first). */
  initialFocal?: 0 | 1;
  className?: string;
}

/**
 * InteractivePhoneDuo: two app screens in the hero's right column (owner vote).
 * Same focal-swap micro-interaction as InteractivePhoneStage, but two screens
 * and no full-bleed ink band; it replaces a flat single PhoneMockup.
 *
 * Hover, focus or tap moves the enlargement to that screen; the previous one
 * shrinks (width transition). Sticky: no reset on mouse leave, matching
 * InteractivePhoneStage. A pure zoom, not navigation, so the slot keeps
 * cursor:default although it is a <button> (name from aria-label, aria-pressed
 * marks the enlarged one; keyboard and screen readers work). 7xZERO floor:
 * solid fill, the PhoneMockup hairline frame, no shadow or gradient.
 */
export function InteractivePhoneDuoOrganism({
  screens,
  ariaLabel,
  initialFocal = 0,
  className,
}: InteractivePhoneDuoProps) {
  const [focal, setFocal] = useState<number>(initialFocal);
  return (
    <div
      className={`${styles.row} ${className ?? ''}`}
      {...(ariaLabel ? { role: 'group', 'aria-label': ariaLabel } : {})}>
      {screens.map((screen, i) => (
        <button
          key={screen.route}
          type='button'
          className={styles.slot}
          data-focal={i === focal}
          aria-pressed={i === focal}
          aria-label={screen.label}
          onMouseEnter={() => setFocal(i)}
          onFocus={() => setFocal(i)}
          onClick={() => setFocal(i)}>
          <PhoneMockupMolecule
            className={styles.phone}
            label={screen.label}
            route={screen.route}
            {...(screen.state !== undefined && { state: screen.state })}
            {...(screen.screenshot !== undefined && {
              screenshot: screen.screenshot,
            })}
            size='xl'
          />
        </button>
      ))}
    </div>
  );
}

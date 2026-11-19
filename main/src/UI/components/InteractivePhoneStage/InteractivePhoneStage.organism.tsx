import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PhoneMockupMolecule } from '../PhoneMockup/PhoneMockup.molecule';
import styles from './InteractivePhoneStage.module.css';

export interface PhoneStageScreen {
  /** Screen description; goes into the PhoneMockup aria-label (the slot's accessible name). */
  label: string;
  route: string;
  state?: string;
  screenshot?: string;
}

export interface InteractivePhoneStageProps {
  /** Exactly 3 screens (1 focal + 2 sides). */
  screens: readonly [PhoneStageScreen, PhoneStageScreen, PhoneStageScreen];
  /** aria-label of the section (group). */
  ariaLabel?: string;
  /** Which screen starts enlarged (default: the middle one). */
  initialFocal?: 0 | 1 | 2;
}

/**
 * InteractivePhoneStage: the only screen-triptych pattern (replaced the static
 * PhoneTriptych). Owner vote: an ink stage breaking the column plus an
 * interactive focal swap.
 *
 * Hover, focus or tap on a screen moves the enlargement to it; the previous
 * large one shrinks. Width animates on desktop and scale animates in the
 * mobile stack. The choice is sticky: the last
 * hover/tap/focus keeps it, no return to the initial focal on mouse leave
 * (owner). A pure zoom, not navigation, so the slot keeps cursor:default though
 * it is a <button> (name from the PhoneMockup aria-label, aria-pressed marks the
 * enlarged one, keyboard and screen readers work).
 */
export function InteractivePhoneStageOrganism({
  screens,
  ariaLabel,
  initialFocal = 1,
}: InteractivePhoneStageProps) {
  const t = useTranslations('components.phoneStage');
  const [focal, setFocal] = useState<number>(initialFocal);
  // DECISION: the visible section label was removed (owner); its existing translation
  // stays as the fallback accessible name when a page provides no more specific one.
  const resolvedAriaLabel = ariaLabel ?? t('kicker');

  return (
    <section className={styles.stage} aria-label={resolvedAriaLabel}>
      {/* <section aria-label> = landmark `region` (NOT role='group', which
       *  would override the landmark). */}
      <div className={styles.inner}>
        {/* No onMouseLeave reset = sticky focal: the last hover/tap/focus
            keeps the enlargement (owner). */}
        <div className={styles.row}>
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
                label={screen.label}
                route={screen.route}
                {...(screen.state !== undefined && { state: screen.state })}
                {...(screen.screenshot !== undefined && {
                  screenshot: screen.screenshot,
                })}
                size='hero'
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

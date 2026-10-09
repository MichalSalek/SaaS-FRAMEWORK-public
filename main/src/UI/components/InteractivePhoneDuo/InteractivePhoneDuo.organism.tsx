import { useState } from 'react';
import { PhoneMockupMolecule } from '../PhoneMockup/PhoneMockup.molecule';
import type { PhoneStageScreen } from '../InteractivePhoneStage/InteractivePhoneStage.organism';
import styles from './InteractivePhoneDuo.module.css';

export interface InteractivePhoneDuoProps {
  /** Dokładnie 2 ekrany (1 fokal + 1 bok). */
  screens: readonly [PhoneStageScreen, PhoneStageScreen];
  /** aria-label grupy (landmark region). */
  ariaLabel?: string;
  /** Który ekran startuje powiększony (default pierwszy). */
  initialFocal?: 0 | 1;
  className?: string;
}

/**
 * InteractivePhoneDuo — in-hero interaktywny duet screenów (głos ownera Q3
 * VOTE 1 = C-in-hero). Młodsze rodzeństwo InteractivePhoneStage: ta sama
 * mikrointerakcja focal-swap, ale 2 ekrany i BEZ full-bleed ink-bandu —
 * siedzi w prawej kolumnie hero (dowód aplikacji zamiast statycznego
 * single-mockupa). Zastąpił płaskie single PhoneMockup na for-studios hero /
 * for-clients hero / for-studios benefits.
 *
 * INTERAKCJA: hover (desktop) / focus (klawiatura) / tap (mobile) przenosi
 * powiększenie na ten ekran; poprzedni-duży maleje robiąc miejsce
 * (transition width). STICKY — ostatni hover/tap/focus utrzymuje powiększenie
 * (brak onMouseLeave reset; spójne z InteractivePhoneStage, głos S35). To
 * czysty zoom, nie nawigacja → slot ma cursor:default mimo że jest <button>
 * (a11y: nazwa z aria-label, aria-pressed = który powiększony, klawiatura/SR
 * działają, ratchet interactive-element). Floor 7×ZERO: solid, hairline ramki
 * z PhoneMockup, zero cienia/gradientu.
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

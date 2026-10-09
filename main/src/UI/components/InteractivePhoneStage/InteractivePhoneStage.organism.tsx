import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EyebrowAtom } from '../Eyebrow/Eyebrow.atom';
import { PhoneMockupMolecule } from '../PhoneMockup/PhoneMockup.molecule';
import styles from './InteractivePhoneStage.module.css';

export interface PhoneStageScreen {
  /** Opis ekranu — trafia do aria-label PhoneMockup (= nazwa dostępna slotu). */
  label: string;
  route: string;
  state?: string;
  screenshot?: string;
}

export interface InteractivePhoneStageProps {
  /** Dokładnie 3 ekrany (1 fokal + 2 boki). */
  screens: readonly [PhoneStageScreen, PhoneStageScreen, PhoneStageScreen];
  /** aria-label sekcji (grupa). */
  ariaLabel?: string;
  /** Opcjonalny kicker-kotwica nad rzędem (np. „za darmo" — głos VOTE 2 ZD-3). */
  kicker?: string;
  /** Który ekran startuje powiększony (default środkowy). */
  initialFocal?: 0 | 1 | 2;
}

/**
 * InteractivePhoneStage — jedyny wzorzec tryptyku screenów po S35 (zastąpił
 * statyczny PhoneTriptych na Home/For-stylists/Pricing). Głos ownera = B+C:
 * ink-stage (przełamanie kolumny ciemnym negatywem) + interaktywny focal-swap.
 *
 * INTERAKCJA: hover (desktop) / focus (klawiatura) / tap (mobile) na ekranie
 * przenosi powiększenie na ten ekran; poprzedni-duży maleje robiąc miejsce
 * (transition width 420ms). Wybór jest STICKY — ostatni hover/tap/focus
 * utrzymuje powiększenie (NIE wraca do startowego fokala po opuszczeniu myszą;
 * głos ownera). To czysty zoom, nie nawigacja — slot ma cursor:default mimo
 * że jest <button> (a11y: nazwa z aria-label PhoneMockup, aria-pressed = który
 * powiększony, klawiatura/SR działają, ratchet interactive-element).
 */
export function InteractivePhoneStageOrganism({
  screens,
  ariaLabel,
  kicker,
  initialFocal = 1,
}: InteractivePhoneStageProps) {
  const t = useTranslations('components');
  const [focal, setFocal] = useState<number>(initialFocal);
  // DECISION (nie usuwaj): kicker WBUDOWANY („Zobacz aplikację od środka") —
  // zawsze pasuje do screenów, więc jeden, spójny tytuł sekcji na wszystkich
  // call-sites (home / for-stylists / pricing). Prop `kicker` zostaje jako
  // opcjonalny override. User 2026-06-25 (uspójnienie tytułu sekcji).
  const resolvedKicker = kicker ?? t('phoneStage.kicker');

  return (
    <section
      className={styles.stage}
      {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}>
      {/* <section aria-label> = landmark `region` (NIE role='group' — to by
       *  nadpisało landmark; code-review S35). */}
      <div className={styles.inner}>
        {resolvedKicker && (
          <div className={styles.kickerWrap}>
            <EyebrowAtom variant='chip'>{resolvedKicker}</EyebrowAtom>
          </div>
        )}
        {/* Brak onMouseLeave reset = sticky focal: ostatni hover/tap/focus
            utrzymuje powiększenie (głos ownera). */}
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

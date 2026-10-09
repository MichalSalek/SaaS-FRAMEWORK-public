/**
 * Trial-framing (antipattern-cena, głos ownera S42/S45): oferta wejścia
 * (np. „Darmowy okres próbny 0 PLN") stoi BOHATEREM tam, gdzie zwykle jest
 * cena, a kwota po trialu schowana małym drukiem („potem X PLN/mies.").
 * Owner 2026-08-19: lede MUSI nieść „0 PLN". Slot bez kwoty = AI-oklep.
 *
 * Ten sam blok żył w TRZECH marketingowych powierzchniach: główny cennik
 * /pricing (tierSection), mini-cennik for-stylists i for-studios. Trzymane były
 * w parytecie RĘCZNIE (komentarze „Parytet z głównym /pricing" = smell driftu).
 * Molekuła zamienia ręczny sync na strukturalną gwarancję: JEDEN kształt DOM
 * (lede-<p> + after-<p>) + JEDEN kontrakt pustego slotu.
 *
 * DECISION (nie usuwaj tego komentarza):
 * - Zwraca FRAGMENT (nie <div>), więc oba <p> zostają BEZPOŚREDNIMI dziećmi
 *   rodzica — na /pricing rodzicem jest subgrid `.tierCard`, którego tory
 *   wyrównują wiersze między kartami PER-ELEMENT; opakowanie w <div> złamałoby
 *   to wyrównanie. Mini-cenniki owijają molekułę we własny `.trialBlock` same.
 * - i18n-dumb + className-parametryzowana (wzorzec `PlanFunnelCtaMolecule`):
 *   każda powierzchnia wstrzykuje SWÓJ namespace i18n (resolved stringi) i SWOJE
 *   klasy CSS, więc unifikacja nie dotyka wyglądu ani treści — tylko struktury.
 * - `renderAfter === null` → slot renderuje twardą spację (Free/Scale/brak ceny),
 *   żeby tor subgrid / rytm wiersza się trzymał (pusty <p> zapadłby się).
 * - Kwota po trialu jest POGRUBIONA (owner 2026-09-14): mały druk zostaje
 *   mały, żeby oferta wejścia dalej była bohaterem, ale cenę do zapłaty ma się
 *   dać znaleźć wzrokiem. Pogrubienie żyje TU, nie w CSS stron: molekuła podaje
 *   wołającemu renderer tagu `<amount>` z kluczy i18n `trialPriceAfter*`, więc
 *   wszystkie trzy powierzchnie mają tę samą wagę (klucz z tagiem bez rendera
 *   to błąd formatowania next-intl, nie cicho niepogrubiona cena). Tag obejmuje kwotę RAZEM z jednostką („79 PLN/mies."), bo
 *   szuka się ceny, nie samej liczby.
 */
import type { ReactNode } from 'react';
import styles from './PlanTrialFraming.module.css';

/** Renderer tagu rich-text `<amount>` (kształt `t.rich` z next-intl). */
type AmountTag = (chunks: ReactNode) => ReactNode;

const amountTag: AmountTag = chunks => (
  <strong className={styles.amount}>{chunks}</strong>
);

interface PlanTrialFramingProps {
  /** Nagłówek-bohater (duży druk): oferta wejścia, nie cena. */
  ledeText: string;
  /**
   * Mała nota „potem X PLN/mies." resolwowana przez i18n wołającego (wariant
   * monthly/yearly + konwersja groszToPln to sprawa call-site'u, bo namespace
   * i klucze różnią się per strona). Wołający przekazuje otrzymany `amount`
   * do `t.rich(klucz, { price, amount })`. `null` → twarda spacja (Free /
   * Scale / brak ceny ze Stripe), by wyrównanie wierszy przetrwało.
   */
  renderAfter: ((amount: AmountTag) => ReactNode) | null;
  ledeClassName?: string;
  afterClassName?: string;
}

export function PlanTrialFramingMolecule({
  ledeText,
  renderAfter,
  ledeClassName,
  afterClassName,
}: PlanTrialFramingProps) {
  return (
    <>
      <p className={ledeClassName}>{ledeText}</p>
      <p className={afterClassName}>
        {renderAfter ? renderAfter(amountTag) : ' '}
      </p>
    </>
  );
}

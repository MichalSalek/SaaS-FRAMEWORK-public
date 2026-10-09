import type { ReactNode } from 'react';
import clsx from 'clsx';
import { NumberMarkerAtom } from '../NumberMarker/NumberMarker.atom';
import styles from './StepsSection.module.css';

interface StepItem {
  title: ReactNode;
  body?: ReactNode;
  /** Opcjonalny slot wizualny (screenshot, ilustracja) pod treścią kroku. */
  media?: ReactNode;
}

type StepsSectionVariant = 'columns' | 'list';

export interface StepsSectionProps {
  /** Numeracja AUTOMATYCZNA z indeksu (01, 02…) przez NumberMarker. */
  steps: ReadonlyArray<StepItem>;
  /**
   * columns — równe kolumny (marker nad treścią).
   * list    — wertykalna lista z markerem po lewej (kanon get-app / home).
   */
  variant?: StepsSectionVariant;
  className?: string;
}

/**
 * StepsSection — kanoniczna sekwencja kroków.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Numeracja WYŁĄCZNIE dla realnych sekwencji (Style Policy §6 — kroki,
 * kolejność, ranking); numerowanie nie-sekwencji = violation logiczna.
 * Skala numerała ograniczona CELOWO: NumberMarker size='sm' (kanon
 * get-app, chwalona „zdrowa skala" — numerał ≤2 kroki skali od body).
 * ZAKAZ podbijania do size='lg' / gigantycznych 90px+ numerali.
 * Porządek niesie semantyczny <ol>; numerał jest dekoracją (aria-hidden
 * wewnątrz NumberMarker).
 */
export function StepsSectionOrganism({
  steps,
  variant = 'list',
  className,
}: StepsSectionProps) {
  return (
    <ol className={clsx(styles.steps, styles[variant], className)}>
      {steps.map((step, idx) => (
        <li key={idx} className={styles.step}>
          <NumberMarkerAtom
            value={idx + 1}
            size='sm'
            className={styles.marker}
          />
          <div className={styles.content}>
            <h3 className={styles.title}>{step.title}</h3>
            {step.body != null && (
              <div className={styles.body}>{step.body}</div>
            )}
            {step.media != null && (
              <div className={styles.media}>{step.media}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

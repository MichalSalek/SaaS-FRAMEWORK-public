import type { ReactNode } from 'react';
import clsx from 'clsx';
import { KeepTogetherTextAtom } from '../KeepTogetherText/KeepTogetherText.atom';
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

  surface?: 'plain' | 'card';
  className?: string;
}

/**
 * StepsSection — kanoniczna sekwencja kroków.
 *
 * DECISION: numbering ONLY for real sequences (Style Policy §6: steps, order, ranking); numbering a
 * non-sequence is a logical violation. The numeral scale is limited ON PURPOSE: NumberMarker
 * size='sm' (the get-app canon, ~28-45px, a numeral at most 2 scale steps from body). Do NOT bump
 * to size='lg' / giant 90px+ numerals. Order is carried by the semantic <ol>; the numeral is
 * decoration (aria-hidden inside NumberMarker).
 */
export function StepsSectionOrganism({
  steps,
  variant = 'list',
  surface = 'plain',
  className,
}: StepsSectionProps) {
  return (
    <ol
      className={clsx(styles.steps, styles[variant], className)}
      data-surface={surface}>
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
              <div className={styles.body}>
                {typeof step.body === 'string' ? (
                  <KeepTogetherTextAtom>{step.body}</KeepTogetherTextAtom>
                ) : (
                  step.body
                )}
              </div>
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

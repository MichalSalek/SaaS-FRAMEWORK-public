// UI/components/StepIndicator/StepIndicator.atom.tsx
// Where you are in a linear process. It only INFORMS: an ordered list with
// `aria-current='step'`, never a button, never a tab, no hover, no pointer.
//
// DECISION (nie usuwaj tego komentarza) — vote `s126-proces`, owner 2026-10-09:
// the look is „Pasek i jedna linia”: a thin bar with one segment per step
// (done and current filled) and under it ONE line with the current step's
// name and the counter („Krok 1 z 3”). The owner on the steppers it replaced:
// „stepper jest za duży i wygląda na interaktywny, a ma tylko pokazywać
// miejsce w procesie”. The other two candidates (the step as the app bar's
// second line; the step names as a path) lost and are gone. Do not add
// numbered dots, names of the other steps, a card around it or any press
// state: every flow of more than one step shows this and nothing else.
//
// `layout` picks the geometry: `compact` sits under an app bar, `inline` sits
// in one row next to a visible page title (the process header decides).

import styles from './StepIndicator.module.css';

export interface StepIndicatorStep {
  id: string;
  label: string;
}

export type StepIndicatorLayout = 'compact' | 'inline';

export interface StepIndicatorProps {
  steps: readonly StepIndicatorStep[];
  currentId: string;
  /** Accessible name of the list, e.g. „Etapy dodawania pracy”. */
  ariaLabel: string;
  /** Already formatted, e.g. „Krok 2 z 3”. */
  counterLabel: string;
  layout?: StepIndicatorLayout;
}

export function StepIndicatorAtom({
  steps,
  currentId,
  ariaLabel,
  counterLabel,
  layout = 'compact',
}: StepIndicatorProps) {
  // A process of one step has no "where am I".
  if (steps.length < 2) {
    return null;
  }
  const currentIndex = Math.max(
    0,
    steps.findIndex(step => step.id === currentId)
  );
  const currentLabel = steps[currentIndex]?.label ?? '';

  return (
    <div className={styles.root} data-layout={layout}>
      <ol className={styles.bar} aria-label={ariaLabel}>
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={styles.segment}
            data-state={index <= currentIndex ? 'reached' : 'pending'}
            aria-current={index === currentIndex ? 'step' : undefined}>
            <span className='sr-only'>{step.label}</span>
          </li>
        ))}
      </ol>
      {/* The list above already says it to a screen reader. */}
      <p className={styles.caption} aria-hidden='true'>
        <span className={styles.captionName}>{currentLabel}</span>
        <span className={styles.captionCounter}>{counterLabel}</span>
      </p>
    </div>
  );
}

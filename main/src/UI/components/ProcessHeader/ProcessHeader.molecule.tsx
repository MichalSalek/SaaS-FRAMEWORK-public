// UI/components/ProcessHeader/ProcessHeader.molecule.tsx
// Header of a linear multi-step flow (add a work, onboarding, delete account).
// It owns the page <h1> and places the step indicator.
//
// DECISION (nie usuwaj tego komentarza) — vote `s126-proces`, owner 2026-10-09
// (with his decisions of 2026-10-08): a step-by-step process has NO intro card
// (`AppHeroOrganism`). The title of the process lives in the top bar only and
// this compact header starts the screen, so the step's first control sits as
// high as it can. The one screen that keeps a card is the onboarding WELCOME
// step. A process of a single step (role activation) gets no indicator.
//
// A screen has exactly ONE <h1>. Under an app bar that heading IS the bar's
// title (AppLayout renders it as <h1> on a screen without an intro card), so
// this header adds none: a second, visually hidden <h1> with the same words
// was read twice by a screen reader. Where there is no app bar (the desktop
// account layout, `useIsUnderAppBar() === false`) this header renders the
// visible page title and the indicator sits in the same row.
//
// Spacing knobs for the page (public, both default to 0), read ONLY while the
// header sits under an app bar; as a visible title row it follows the page's
// own rhythm:
//   --process-header-margin-top, --process-header-margin-bottom
// e.g. a page whose column has a 20px top padding and a 20px gap sets both to
// -20px on its root class, and the header's measured 48px is all it spends.

import { useIsUnderAppBar } from '../AppHero/appHeroVisibility';
import {
  StepIndicatorAtom,
  type StepIndicatorStep,
} from '../StepIndicator/StepIndicator.atom';
import styles from './ProcessHeader.module.css';

export type ProcessHeaderTitleVisibility = 'auto' | 'visible' | 'hidden';

export interface ProcessHeaderProps {
  title: string;
  steps?: readonly StepIndicatorStep[];
  currentId?: string;
  stepAriaLabel?: string;
  /** Already formatted, e.g. „Krok 2 z 3”. */
  counterLabel?: string;
  /**
   * `auto` = left to the app bar where there is one, rendered here where
   * there is none. `visible` / `hidden` force it for layouts that know.
   */
  titleVisibility?: ProcessHeaderTitleVisibility;
}

export function ProcessHeaderMolecule({
  title,
  steps,
  currentId,
  stepAriaLabel,
  counterLabel,
  titleVisibility = 'auto',
}: ProcessHeaderProps) {
  const underAppBar = useIsUnderAppBar();
  const titleOnScreen =
    titleVisibility === 'visible' ||
    (titleVisibility === 'auto' && !underAppBar);
  const hasIndicator =
    steps !== undefined &&
    steps.length > 1 &&
    currentId !== undefined &&
    stepAriaLabel !== undefined &&
    counterLabel !== undefined;

  // Nothing to show: the bar carries the title and the flow has one step.
  if (!titleOnScreen && !hasIndicator) {
    return null;
  }

  return (
    <div
      className={styles.root}
      data-title={titleOnScreen ? 'visible' : 'hidden'}>
      {titleOnScreen && <h1 className={styles.title}>{title}</h1>}
      {hasIndicator && (
        <StepIndicatorAtom
          steps={steps}
          currentId={currentId}
          ariaLabel={stepAriaLabel}
          counterLabel={counterLabel}
          layout={titleOnScreen ? 'inline' : 'compact'}
        />
      )}
    </div>
  );
}

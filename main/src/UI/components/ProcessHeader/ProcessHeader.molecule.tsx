// Header of a linear multi-step flow: owns the page <h1>, places the step indicator.
//
// DECISION: a step-by-step process has NO intro card (`AppHeroOrganism`); its title lives in the
// top bar and this compact header starts the screen, so the first control sits as high as it
// can. Only the onboarding WELCOME step keeps a card; a single-step process gets no indicator. (owner)
//
// One <h1> per screen: under an app bar the bar's title is the <h1>, so this header adds none (a
// hidden duplicate was read twice). Without a bar (`useIsUnderAppBar() === false`) it renders the
// visible title beside the indicator. Spacing knobs (public, default 0, read ONLY under an app
// bar): --process-header-margin-top / --process-header-margin-bottom.

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

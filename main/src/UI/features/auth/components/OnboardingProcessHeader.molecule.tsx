// UI/features/auth/components/OnboardingProcessHeader.molecule.tsx
//
// Header of the onboarding steps AFTER the welcome: the shared process header
// (title in the top bar, compact step indicator) plus the step announcement
// for screen readers.
//
// DECISION (nie usuwaj tego komentarza) — vote `s126-proces`, owner 2026-10-09:
// this replaced the local orb stepper and the step pill in the intro card.
// WELCOME keeps its card and shows no indicator (`withIndicator={false}`), yet
// it still COUNTS as step 1: the indicator's first appearance reads „Krok 2
// z N” with two segments filled, so the head start is kept.

import { useTranslations } from 'next-intl';
import { ProcessHeaderMolecule } from '../../../components/ProcessHeader/ProcessHeader.molecule';
import { ONBOARDING_STEP } from '../onboarding.types';

interface OnboardingProcessHeaderProps {
  /** Ordered semantic step ids of the active flow (stepSequenceForRole). */
  sequence: readonly number[];
  /** Current semantic step id (one of `sequence`). */
  currentStep: number;
  /** False on WELCOME: the intro card is that step's header. */
  withIndicator: boolean;
}

export function OnboardingProcessHeaderMolecule({
  sequence,
  currentStep,
  withIndicator,
}: OnboardingProcessHeaderProps) {
  const t = useTranslations('pages.onboarding');

  // The label is SEMANTIC (keyed to the step id), not positional: a client
  // skips BASIC_INFO, so her third step reads „Ustawienia”, never „Dane”.
  // Literal keys keep next-intl's typed `t` sound.
  const labelByStepId: Record<number, string> = {
    [ONBOARDING_STEP.WELCOME]: t('stepLabel1'),
    [ONBOARDING_STEP.ROLE]: t('stepLabel2'),
    [ONBOARDING_STEP.BASIC_INFO]: t('stepLabel3'),
    [ONBOARDING_STEP.PREFERENCES]: t('stepLabel4'),
    [ONBOARDING_STEP.CHECKOUT]: t('stepLabel5'),
  };
  const steps = sequence.map(stepId => ({
    id: String(stepId),
    label: labelByStepId[stepId] ?? '',
  }));
  // Contiguous 1..N position; an unknown step falls back to the first one.
  const position = Math.max(0, sequence.indexOf(currentStep)) + 1;
  const counterLabel = t('stepOf', {
    current: position,
    total: sequence.length,
  });

  return (
    <>
      {withIndicator ? (
        <ProcessHeaderMolecule
          title={t('processTitle')}
          steps={steps}
          currentId={String(currentStep)}
          stepAriaLabel={t('stepsAriaLabel')}
          counterLabel={counterLabel}
        />
      ) : null}

      {/* SR-only step announcement — a narrow, STABLE polite live region
          (mounted on WELCOME too, so the first step change is heard). Its text
          (position + step name) changes on transition so screen-reader users
          hear the new step BY NAME, without re-reading the whole step body
          (the checkout step embeds the Stripe PaymentElement iframe —
          announcing that on every step change is noise). The visible step
          section is intentionally NOT a live region. */}
      <p className='sr-only' aria-live='polite'>
        {`${counterLabel}, ${labelByStepId[currentStep] ?? ''}`}
      </p>
    </>
  );
}

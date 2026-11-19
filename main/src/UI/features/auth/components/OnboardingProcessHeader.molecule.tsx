// UI/features/auth/components/OnboardingProcessHeader.molecule.tsx
//
// Header of the onboarding steps: the shared process header (title in the top
// bar, compact step indicator) plus the step announcement for screen readers.
//
// DECISION: this replaced the local orb stepper and the step pill in the intro
// card. Since the role-only onboarding the indicator shows only when there is something to count:
// role + plan for a stylist with a plan intent ("Krok 1 z 2"); the one-screen flow shows none.
// (owner)

import { useTranslations } from 'next-intl';
import { ProcessHeaderMolecule } from '../../../components/ProcessHeader/ProcessHeader.molecule';
import { ONBOARDING_STEP } from '../onboarding.types';

interface OnboardingProcessHeaderProps {
  /** Ordered semantic step ids of the active flow (stepSequenceForRole). */
  sequence: readonly number[];
  /** Current semantic step id (one of `sequence`). */
  currentStep: number;
}

export function OnboardingProcessHeaderMolecule({
  sequence,
  currentStep,
}: OnboardingProcessHeaderProps) {
  const t = useTranslations('pages.onboarding');

  // The label is SEMANTIC (keyed to the step id), not positional: a client
  // skips BASIC_INFO, so her third step reads „Ustawienia”, never „Dane”.
  // Literal keys keep next-intl's typed `t` sound.
  const labelByStepId: Record<number, string> = {
    [ONBOARDING_STEP.ROLE]: t('stepLabel2'),
    [ONBOARDING_STEP.CHECKOUT]: t('stepLabel5'),
  };
  // A one-screen flow (no plan intent) has nothing to count: the bar carries
  // the process name and the screen its own heading.
  const withIndicator = sequence.length > 1;
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
          (mounted on the first step too, so the first step change is heard). Its text
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

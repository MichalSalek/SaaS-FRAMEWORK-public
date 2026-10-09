// UI/features/gallery/components/UploadProcessHeader.organism.tsx
// Header of the "add a work" wizard: the shared process header with the
// wizard's three steps. The title itself is shown by the app bar (the layout's
// `title`, the same string), so nothing here writes to the bar.
//
// DECISION (nie usuwaj tego komentarza) — vote `s126-proces`, owner 2026-10-09:
// the intro card („Dodaj nową pracę”) and the boxed three-segment stepper with
// numbered dots are gone for good. Owner on the old screen: „stepper jest za
// duży i wygląda na interaktywny”, „sporo pustego miejsca, rozlazły widok”.
// Do not bring a card or a second title back above the steps.

import { useTranslations } from 'next-intl';
import { ProcessHeaderMolecule } from '../../../components/ProcessHeader/ProcessHeader.molecule';

interface UploadProcessHeaderProps {
  currentStep: 1 | 2 | 3;
}

export function UploadProcessHeaderOrganism({
  currentStep,
}: UploadProcessHeaderProps) {
  const t = useTranslations('pages.gallery');

  const steps = [
    { id: '1', label: t('uploadStepLabelSelect') },
    { id: '2', label: t('uploadStepLabelTag') },
    { id: '3', label: t('uploadStepLabelReview') },
  ] as const;

  return (
    <ProcessHeaderMolecule
      title={t('uploadTitle')}
      steps={steps}
      currentId={String(currentStep)}
      stepAriaLabel={t('uploadStepsAriaLabel')}
      counterLabel={t('uploadStepCounter', {
        current: currentStep,
        total: steps.length,
      })}
    />
  );
}

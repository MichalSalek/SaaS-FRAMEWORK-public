// UI/features/salon-profile/SalonTapSaveLine.molecule.tsx
// The save line of a salon box whose control saves on the tap (colour, team
// switch, pinned works): no „dirty” state, quiet until its box is the one
// being saved, then pending, saved or failed with a retry.

import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { ProfileSaveLineMolecule } from '../shared/profile/ProfileSaveLine.molecule';

export function salonEditorSaveLine(
  key: string,
  isSaving: boolean,
  isDirty: boolean,
  hasFailure: boolean,
  onRetry: () => void
) {
  return (
    <ProfileSaveLineMolecule
      key={key}
      isSaving={isSaving}
      isDirty={isDirty}
      hasFailure={hasFailure}
      onRetry={onRetry}
    />
  );
}

export function salonTapSaveLine(
  active: boolean,
  isSaving: boolean,
  hasFailure: boolean,
  onRetry: () => void
) {
  return (
    <SalonTapSaveLineMolecule
      active={active}
      isSaving={isSaving}
      hasFailure={hasFailure}
      onRetry={onRetry}
    />
  );
}

export function SalonTapSaveLineMolecule({
  active,
  isSaving,
  hasFailure,
  onRetry,
}: {
  /** This box started the latest save. */
  active: boolean;
  isSaving: boolean;
  hasFailure: boolean;
  onRetry: () => void;
}) {
  const tOutcome = useTranslations('components.outcomeFeedback');
  const tButtons = useTranslations('buttons');
  const state = !active
    ? 'idle'
    : hasFailure
      ? 'error'
      : isSaving
        ? 'pending'
        : 'complete';
  const message = {
    idle: '',
    error: tOutcome('saveFailed'),
    pending: tOutcome('savePending'),
    complete: tOutcome('saveDone'),
  }[state];
  return (
    <CompletionLineMolecule
      state={state}
      message={message}
      reserveMessage={tOutcome('saveFailed')}>
      {state === 'error' && (
        <ButtonAtom variant='outlined' size='sm' onClick={onRetry}>
          {tButtons('retry')}
        </ButtonAtom>
      )}
    </CompletionLineMolecule>
  );
}

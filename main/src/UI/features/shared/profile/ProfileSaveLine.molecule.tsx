// UI/features/shared/profile/ProfileSaveLine.molecule.tsx
// The save state of a profile box that saves itself: one quiet line, always mounted
// (the stylist's own profile and the published salon profile).
//
// DECISION: the form saves itself (autosave on leaving a field, directive 2026-07-12), but nothing
// on screen said so ("a long form without visible saving"). "Zapisywanie..." used to be glued to the
// title and an error jumped in as a new row, pushing all fields down. Active feedback reserves space
// for retry; the empty idle state occupies no error/button reservation. The shared completion line owns
// success feedback. Idle instructions are silent; real save outcomes remain.
// A newer dirty draft removes the previous saved state until all queued writes
// and the authoritative profile data acknowledge it. (owner)

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { CompletionLineMolecule } from '../../../components/OutcomeFeedback/CompletionLine.molecule';

interface ProfileSaveLineProps {
  isSaving: boolean;
  isDirty: boolean;
  hasFailure: boolean;
  onRetry: () => void;
}

export function ProfileSaveLineMolecule({
  isSaving,
  isDirty,
  hasFailure,
  onRetry,
}: ProfileSaveLineProps) {
  const tButtons = useTranslations('buttons');
  const [savedOnce, setSavedOnce] = useState(false);
  const wasSavingRef = useRef(false);
  useEffect(() => {
    if (wasSavingRef.current && !isSaving && !hasFailure) {
      setSavedOnce(true);
    }
    wasSavingRef.current = isSaving;
  }, [isSaving, hasFailure]);

  const tOutcome = useTranslations('components.outcomeFeedback');
  const state = isSaving
    ? 'pending'
    : hasFailure
      ? 'error'
      : isDirty
        ? 'dirty'
        : savedOnce
          ? 'complete'
          : 'idle';
  const message =
    state === 'pending'
      ? tOutcome('savePending')
      : state === 'error'
        ? tOutcome('saveFailed')
        : state === 'dirty'
          ? tOutcome('saveDirty')
          : state === 'complete'
            ? tOutcome('saveDone')
            : '';
  return (
    <CompletionLineMolecule
      state={state}
      message={message}
      reserveAction={
        <ButtonAtom variant='outlined' size='sm'>
          {tButtons('retry')}
        </ButtonAtom>
      }
      reserveMessage={tOutcome('saveFailed')}>
      {hasFailure && !isSaving && (
        <ButtonAtom variant='outlined' size='sm' onClick={onRetry}>
          {tButtons('retry')}
        </ButtonAtom>
      )}
    </CompletionLineMolecule>
  );
}

import { useEffect, useRef, useState } from 'react';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { InputAtom } from '../../components/Input/Input.atom';
import { useTranslations } from 'next-intl';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { resolveSaveFeedbackState } from '../../../application/outcome-feedback/outcome-feedback.helpers';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { DetailNoteCalloutMolecule } from './ClientSessionDetailPage.blocks.molecule';
import { useUpdateSessionNote } from './hooks/useUpdateSessionNote';
import styles from './ClientSessionDetailPage.module.css';
import type { TSessions } from './sessionTime.formatters';

/**
 * The client's note to her stylist. The backend (set-note, side 'client') and
 * the stylist's read-only callout existed, and the copy invited the client to
 * write one, but nothing let her type it. Save on blur, like the stylist's own
 * note; a finished session keeps the read-only callout (backend: INVALID_STATE),
 * and shows nothing when she wrote nothing (the invitation to write would be
 * false there).
 */
export function ClientSessionNoteOrganism({
  session,
  isTerminal,
  t,
}: {
  session: SessionContainerDetailDTO;
  isTerminal: boolean;
  t: TSessions;
}) {
  const updateNote = useUpdateSessionNote(session.id, 'client');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const savedNote = session.clientNote ?? '';
  const [noteValue, setNoteValue] = useState(savedNote);
  const [saveFailed, setSaveFailed] = useState(false);
  const initialized = useRef(false);
  // An edit typed while the previous save was in flight is sent afterwards.
  const latestNote = useRef(noteValue);
  latestNote.current = noteValue;

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setNoteValue(savedNote);
    }
  }, [savedNote]);

  // The note saves on blur, and leaving the screen is not always a blur: the
  // Android back gesture and a tap on the tab bar unmount the field with the
  // text still in it. What she typed is sent on the way out.
  const savedNoteRef = useRef(savedNote);
  savedNoteRef.current = savedNote;
  const lastSent = useRef<string | null>(null);
  const sendNote = useRef(updateNote.mutate);
  sendNote.current = updateNote.mutate;
  useEffect(
    () => () => {
      const typed = latestNote.current.trim();
      // Already saved, or already handed to a save that is on its way.
      if (typed !== savedNoteRef.current && typed !== lastSent.current) {
        sendNote.current(latestNote.current);
      }
    },
    []
  );

  if (isTerminal) {
    return savedNote.length > 0 ? (
      <DetailNoteCalloutMolecule clientNote={savedNote} t={t} />
    ) : null;
  }

  function save(value: string) {
    lastSent.current = value.trim();
    updateNote.mutate(value, {
      onSuccess: () => {
        setSaveFailed(false);
        if (latestNote.current.trim() !== value.trim()) {
          save(latestNote.current);
        }
      },
      onError: () => setSaveFailed(true),
    });
  }

  function handleBlur() {
    if (updateNote.isPending || noteValue.trim() === savedNote) {
      return;
    }
    save(noteValue);
  }

  const showFailed =
    saveFailed && !updateNote.isPending && noteValue.trim() !== savedNote;
  const feedback = resolveSaveFeedbackState({
    pending: updateNote.isPending,
    failed: showFailed,
    dirty: noteValue.trim() !== savedNote,
    acknowledged: updateNote.isSuccess,
  });

  return (
    <section className={styles.note}>
      <InputAtom
        multiline
        label={t('detailNoteCalloutTitle')}
        placeholder={t('detailNoteCalloutEmpty')}
        value={noteValue}
        maxLength={SESSION_CONTAINER_CONFIG.SESSION_NOTE_MAX_LENGTH}
        onChange={event => setNoteValue(event.target.value)}
        onBlur={handleBlur}
        rows={3}
      />
      {/* Always mounted, one line tall: „Zapisywanie...” and the failure
          marker appear without pushing the page. */}
      <CompletionLineMolecule
        state={feedback}
        message={
          feedback === 'pending'
            ? tOutcome('savePending')
            : feedback === 'error'
              ? tOutcome('saveFailed')
              : feedback === 'complete'
                ? tOutcome('saveDone')
                : tOutcome('saveDirty')
        }
        reserveMessage={tOutcome('saveFailed')}
        reserveAction={
          <ButtonAtom variant='text' size='sm'>
            {t('retryBtn')}
          </ButtonAtom>
        }>
        {showFailed && (
          <ButtonAtom
            variant='text'
            size='sm'
            onMouseDown={event => event.preventDefault()}
            onClick={() => save(noteValue)}>
            {t('retryBtn')}
          </ButtonAtom>
        )}
      </CompletionLineMolecule>
    </section>
  );
}

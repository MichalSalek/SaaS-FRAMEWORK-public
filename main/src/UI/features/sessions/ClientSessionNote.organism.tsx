import { useEffect, useRef, useState } from 'react';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { InputAtom } from '../../components/Input/Input.atom';
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

  if (isTerminal) {
    return savedNote.length > 0 ? (
      <DetailNoteCalloutMolecule clientNote={savedNote} t={t} />
    ) : null;
  }

  function save(value: string) {
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
      <div className={styles.noteStatus}>
        {updateNote.isPending && (
          <span role='status'>{t('inboxNoteSaving')}</span>
        )}
        {showFailed && (
          <span className={styles.noteSaveFailed} role='alert'>
            <span>{t('noteSaveFailed')}</span>
            <ButtonAtom
              variant='text'
              size='sm'
              onMouseDown={event => event.preventDefault()}
              onClick={() => save(noteValue)}>
              {t('retryBtn')}
            </ButtonAtom>
          </span>
        )}
      </div>
    </section>
  );
}

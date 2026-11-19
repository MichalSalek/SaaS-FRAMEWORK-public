import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getCrmNoteEditLimit } from '@kernel/domain/visit/visit.config';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import { TrashIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { ConfirmDeleteDialogMolecule } from './ClientCardPage.confirm-delete.molecule';
import { formatDateTime } from '../../../application/date/date.utils';
import { SectionHeader } from './ClientCardPage.parts.organism';
import { CompletionLineMolecule } from '../../components/OutcomeFeedback/CompletionLine.molecule';
import { resolveSaveFeedbackState } from '../../../application/outcome-feedback/outcome-feedback.helpers';
import styles from './ClientCardPage.module.css';
import {
  useNoteConflict,
  type NoteRevision,
} from '../shared/notes/hooks/useNoteConflict';
import { NoteConflictMolecule } from '../shared/notes/components/NoteConflict.molecule';

function clampCrmNote(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join('');
}

export function CrmNoteSectionOrganism({
  initialNote,
  updatedAt,
  isLoading,
  isError,
  onRetry,
  isRetrying = false,
  isSaving,
  isSaveError = false,
  saveError,
  isSaveSuccess = false,
  savedNote,
  resetSave,
  fetchCurrent,
  isDeleting,
  isDeleteError,
  onSave,
  onDelete,
}: {
  initialNote: string | null | undefined;
  updatedAt: string | null | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isRetrying?: boolean;
  isSaving: boolean;
  /** The last save failed (the upsert mutation's isError). */
  isSaveError?: boolean;
  saveError?: unknown;
  isSaveSuccess?: boolean;
  savedNote?: NoteRevision | undefined;
  resetSave?: () => void;
  fetchCurrent?: () => Promise<NoteRevision>;
  isDeleting: boolean;
  isDeleteError: boolean;
  onSave: (
    note: string,
    expectedUpdatedAt: string | null,
    exactRevision?: boolean
  ) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('clientCard');
  const tOutcome = useTranslations('components.outcomeFeedback');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  const serverNote = initialNote ?? '';
  const [note, setNote] = useState(serverNote);
  const [baseline, setBaseline] = useState({
    note: serverNote,
    updatedAt: updatedAt ?? null,
  });
  const draftRevision = useRef(updatedAt ?? null);
  const ownSaved = useRef<NoteRevision | undefined>(undefined);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  // initialNote === undefined = the query is not resolved yet (NOT a clean baseline). The component
  // mounts before crmNote resolves → useState('') seeds a placeholder; when the real note arrives,
  // `'' !== note` would make isDirty=true and sync-unless-dirty would NEVER adopt it (the note
  // invisible, and a blur would overwrite it with an empty one = data loss). hasHydrated adopts the
  // FIRST defined server value; after that the normal sync-unless-dirty applies.
  const hasHydrated = useRef(initialNote !== undefined);
  const sawDeleting = useRef(false);
  const conflict = useNoteConflict(
    saveError,
    isSaveSuccess,
    fetchCurrent ?? (() => Promise.reject(new Error('note fetch unavailable')))
  );
  const isDirty = note !== baseline.note;
  const deleteBusy = pendingDelete || isDeleting;
  const noteCount = countCodePoints(note);
  const noteLimit = getCrmNoteEditLimit(serverNote);
  const atLimit = noteCount >= noteLimit;
  // Save-on-blur has no button, so a failed save needs a mark that outlives
  // the toast. The draft already survives (serverNote did not move, so the
  // field stays dirty and the sync effect leaves it alone); this only says so
  // and offers the retry. Cleared by the next save attempt or by a note that
  // is no longer dirty (e.g. edited back to the server value).
  const saveFailed = isSaveError && isDirty && !isSaving;

  useEffect(() => {
    if (initialNote !== undefined && !hasHydrated.current) {
      hasHydrated.current = true;
      setNote(serverNote);
      draftRevision.current = updatedAt ?? null;
      setBaseline({ note: serverNote, updatedAt: updatedAt ?? null });
      return;
    }
    if (!isDirty && !isSaving && !isDeleting && !conflict.active) {
      setNote(serverNote);
      draftRevision.current = updatedAt ?? null;
      if (
        baseline.note !== serverNote ||
        baseline.updatedAt !== (updatedAt ?? null)
      ) {
        setBaseline({ note: serverNote, updatedAt: updatedAt ?? null });
      }
    }
  }, [
    initialNote,
    isDirty,
    isSaving,
    isDeleting,
    conflict.active,
    serverNote,
    updatedAt,
    baseline,
  ]);

  useEffect(() => {
    if (savedNote !== undefined && savedNote !== ownSaved.current) {
      ownSaved.current = savedNote;
      draftRevision.current = savedNote.updatedAt;
      setBaseline({
        note: savedNote.note ?? '',
        updatedAt: savedNote.updatedAt,
      });
    }
  }, [savedNote]);

  useEffect(() => {
    if (isDeleting) {
      sawDeleting.current = true;
    }
    if (!pendingDelete || isDeleting || !sawDeleting.current) {
      return;
    }
    sawDeleting.current = false;
    setPendingDelete(false);
    // This effect reacts to the delete merely FINISHING, so it closed the dialog the same way on
    // success and on failure — and then the only trace of a failure was the note still being there.
    // Success closes the dialog anyway through the effect above (empty note from the server), so
    // only the error case remains here: the dialog STAYS open so she can retry.
    if (isDeleteError) {
      return;
    }
    setNote('');
    draftRevision.current = updatedAt ?? null;
    setBaseline({ note: '', updatedAt: updatedAt ?? null });
    setDeleteDialogOpen(false);
  }, [pendingDelete, isDeleting, isDeleteError, updatedAt]);

  const handleBlur = () => {
    // `isSaving` too: a note edited back to the server text while another save
    // is in flight must still be sent (serialized scope), or the in-flight text
    // lands as the final one and the field silently disagrees with the server.
    if (
      (isDirty || isSaving) &&
      !deleteDialogOpen &&
      !pendingDelete &&
      !conflict.active
    ) {
      onSave(note, draftRevision.current);
    }
  };

  // The note saves itself on blur, so the line under the title always says
  // where it stands: saving or saved when. Idle instructions stay silent.
  const status = isSaving
    ? t('saving')
    : updatedAt
      ? t('updatedAt', {
          date: formatDateTime(updatedAt, locale).replaceAll(' ', '\u00a0'),
        })
      : '';
  const feedback = resolveSaveFeedbackState({
    pending: isSaving,
    failed: saveFailed,
    dirty: isDirty,
    acknowledged: updatedAt != null && updatedAt !== '',
  });

  return (
    <section className={styles.block}>
      <SectionHeader title={t('noteTitle')} />
      <CompletionLineMolecule
        state={feedback}
        message={
          feedback === 'error'
            ? tOutcome('saveFailed')
            : feedback === 'dirty'
              ? tOutcome('saveDirty')
              : status
        }
        reserveMessage={tOutcome('saveFailed')}
        reserveAction={
          <ButtonAtom variant='text' size='sm'>
            {tButtons('retry')}
          </ButtonAtom>
        }>
        {saveFailed && !conflict.active && (
          <ButtonAtom
            type='button'
            variant='text'
            size='sm'
            onMouseDown={event => event.preventDefault()}
            onClick={() => onSave(note, draftRevision.current)}>
            {tButtons('retry')}
          </ButtonAtom>
        )}
      </CompletionLineMolecule>
      {/* DECISION: on a load ERROR there is ZERO edit field. An unresolved query gives
          `initialNote === undefined`, the same state the `hasHydrated` comment describes as
          data loss, except that on error `isLoading` has already dropped and the field rendered
          EMPTY and EDITABLE: she saw "no note", typed anything, and the blur saved it over a
          note that still exists on the server. So the error state must exclude the editor, not
          just decorate it. But ONLY when the note is really unknown: TanStack keeps the data on
          a failed background refresh, so a bare `isError` would remove the editor after a
          failed refresh when the note is already loaded and safely editable. */}
      {isError && initialNote === undefined ? (
        <ErrorStateMolecule
          message={t('crmNoteLoadError')}
          retryLabel={tButtons('retry')}
          onRetry={onRetry}
          isRetrying={isRetrying}
        />
      ) : isLoading ? (
        <SkeletonAtom variant='rect' width='100%' height={196} />
      ) : (
        <div className={styles.noteCard} data-app-section='plain'>
          <textarea
            className={styles.noteTextarea}
            value={note}
            placeholder={t('notePlaceholder')}
            aria-label={t('notePlaceholder')}
            onChange={event =>
              setNote(clampCrmNote(event.target.value, noteLimit))
            }
            onBlur={handleBlur}
          />
          <div className={styles.noteFooter}>
            <span
              className={
                atLimit
                  ? `${styles.noteCounter} ${styles.noteCounterLimit}`
                  : styles.noteCounter
              }>
              {t('noteCounter', {
                count: noteCount,
                max: noteLimit,
              })}
            </span>
            {serverNote !== '' && (
              <ButtonAtom
                type='button'
                variant='outlined'
                size='sm'
                icon={<TrashIcon size={16} />}
                disabled={deleteBusy}
                onMouseDown={event => event.preventDefault()}
                onClick={() => setDeleteDialogOpen(true)}>
                {t('noteDelete')}
              </ButtonAtom>
            )}
          </div>
        </div>
      )}
      {conflict.state && (
        <NoteConflictMolecule
          state={conflict.state}
          draft={note}
          saving={isSaving}
          onRefresh={() => void conflict.refresh()}
          onUseStored={current => {
            setNote(current.note ?? '');
            draftRevision.current = current.updatedAt;
            setBaseline({
              note: current.note ?? '',
              updatedAt: current.updatedAt,
            });
            resetSave?.();
            conflict.dismiss();
          }}
          onOverwrite={revision => onSave(note, revision, true)}
        />
      )}
      <ConfirmDeleteDialogMolecule
        open={deleteDialogOpen}
        title={t('noteDeleteTitle')}
        body={t('noteDeleteBody')}
        confirmLabel={t('noteDelete')}
        cancelLabel={tButtons('cancel')}
        busy={deleteBusy}
        onConfirm={() => {
          setPendingDelete(true);
          onDelete();
        }}
        onClose={() => setDeleteDialogOpen(false)}
      />
    </section>
  );
}

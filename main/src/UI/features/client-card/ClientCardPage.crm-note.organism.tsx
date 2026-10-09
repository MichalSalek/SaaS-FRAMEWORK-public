import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import { TrashIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { ConfirmDeleteDialogMolecule } from './ClientCardPage.confirm-delete.molecule';
import { formatDateTime } from '../../../application/date/date.utils';
import { SectionHeader } from './ClientCardPage.parts.organism';
import styles from './ClientCardPage.module.css';

function clampCrmNote(value: string): string {
  return Array.from(value).slice(0, VISIT_CONFIG.CRM_NOTE_MAX).join('');
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
  isDeleting: boolean;
  isDeleteError: boolean;
  onSave: (note: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations('clientCard');
  const tButtons = useTranslations('buttons');
  const locale = useLocale();
  const serverNote = initialNote ?? '';
  const [note, setNote] = useState(serverNote);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  // initialNote === undefined = query jeszcze nie rozwiązana (NIE czysty baseline).
  // Komponent montuje się przed rozwiązaniem crmNote → useState('') seeduje placeholder;
  // gdy nadejdzie realna notatka, `'' !== note` uczyniłoby isDirty=true i sync-unless-dirty
  // NIGDY by jej nie zaadoptował (notatka niewidoczna, a blur nadpisałby ją pustą = data-loss).
  // hasHydrated adoptuje PIERWSZĄ zdefiniowaną wartość serwera; potem normalny sync-unless-dirty.
  const hasHydrated = useRef(initialNote !== undefined);
  const prevServerNote = useRef(serverNote);
  const sawDeleting = useRef(false);
  const isDirty = note !== serverNote;
  const deleteBusy = pendingDelete || isDeleting;
  const noteCount = countCodePoints(note);
  const atLimit = noteCount >= VISIT_CONFIG.CRM_NOTE_MAX;
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
      return;
    }
    if (!isDirty) {
      setNote(serverNote);
    }
  }, [initialNote, isDirty, serverNote]);

  // Server note went from non-empty to empty (delete success via query cache).
  // Force-clear the local draft so a dirty edit cannot resurrect the note.
  useEffect(() => {
    if (prevServerNote.current !== '' && serverNote === '') {
      setNote('');
      setPendingDelete(false);
      setDeleteDialogOpen(false);
    }
    prevServerNote.current = serverNote;
  }, [serverNote]);

  useEffect(() => {
    if (isDeleting) {
      sawDeleting.current = true;
    }
    if (!pendingDelete || isDeleting || !sawDeleting.current) {
      return;
    }
    sawDeleting.current = false;
    setPendingDelete(false);
    // Ten efekt reaguje na SAMO ZAKONCZENIE kasowania, wiec zamykal dialog tak
    // samo po sukcesie i po porazce — a wtedy jedynym sladem niepowodzenia byla
    // notatka, ktora nadal tam jest. Sukces i tak domyka dialog efektem wyzej
    // (pusta notatka z serwera), wiec tutaj zostaje juz tylko przypadek bledu:
    // dialog ZOSTAJE otwarty, zeby dalo sie sprobowac ponownie.
    if (isDeleteError) {
      return;
    }
    setDeleteDialogOpen(false);
  }, [pendingDelete, isDeleting, isDeleteError]);

  const handleBlur = () => {
    // `isSaving` too: a note edited back to the server text while another save
    // is in flight must still be sent (serialized scope), or the in-flight text
    // lands as the final one and the field silently disagrees with the server.
    if ((isDirty || isSaving) && !deleteDialogOpen && !pendingDelete) {
      onSave(note);
    }
  };

  // The note saves itself on blur, so the line under the title always says
  // where it stands: saving, saved when, or how saving works.
  const status = isSaving
    ? t('saving')
    : updatedAt
      ? t('updatedAt', { date: formatDateTime(updatedAt, locale) })
      : t('noteAutosaveHint');

  return (
    <section className={styles.block}>
      <SectionHeader title={t('noteTitle')} meta={status} />
      {/* DECISION (nie usuwaj tego komentarza) — PRZY BLEDZIE ZERO POLA EDYCJI:
          nierozwiazana kwerenda daje `initialNote === undefined`, czyli ten sam
          stan, ktory komentarz przy `hasHydrated` opisuje jako data-loss — tyle ze
          na bledzie `isLoading` juz opada i pole renderowalo sie PUSTE i EDYTOWALNE.
          Uzytkowniczka widziala „brak notatki", dopisywala cokolwiek, a blur
          zapisywal to NA notatce, ktora po stronie serwera dalej istnieje.
          Stan bledu musi wiec wykluczac edytor, a nie tylko go ozdabiac. Ale
          WYLACZNIE wtedy, gdy notatki naprawde nie znamy: TanStack ustawia status
          bledu zachowujac dane, wiec samo `isError` zabieraloby edytor rowniez po
          nieudanym odswiezeniu w tle, kiedy notatka jest juz wczytana i edytowalna
          bez ryzyka. */}
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
        <div className={styles.noteCard}>
          <textarea
            className={styles.noteTextarea}
            value={note}
            placeholder={t('notePlaceholder')}
            aria-label={t('notePlaceholder')}
            onChange={event => setNote(clampCrmNote(event.target.value))}
            onBlur={handleBlur}
          />
          {saveFailed && (
            <p className={styles.noteSaveFailed} role='alert'>
              {t('noteSaveFailed')}
              <ButtonAtom
                type='button'
                variant='outlined'
                size='sm'
                onMouseDown={event => event.preventDefault()}
                onClick={() => onSave(note)}>
                {tButtons('retry')}
              </ButtonAtom>
            </p>
          )}
          <div className={styles.noteFooter}>
            <span
              className={
                atLimit
                  ? `${styles.noteCounter} ${styles.noteCounterLimit}`
                  : styles.noteCounter
              }>
              {t('noteCounter', {
                count: noteCount,
                max: VISIT_CONFIG.CRM_NOTE_MAX,
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
